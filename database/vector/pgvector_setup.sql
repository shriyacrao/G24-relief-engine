-- =====================================================================
-- Disaster Response & Smart Relief Logistics Engine
-- G24 - Sem: 5 | Sec: H
-- Team Member 1: Name: Shreya C Rao | SRN: PES2UG24CS481
-- Team Member 2: Name: Shriya C Rao | SRN: PES2UG24CS496
--
-- VECTOR DATABASE: PostgreSQL 16 + pgvector
-- Run as the postgres superuser:
--     psql -U postgres -f database/vector/pgvector_setup.sql
--
--  1. Database + extension
--  2. Tables  (sos_embeddings, item_embeddings) with CHECK constraints
--  3. Indexes (HNSW for cosine kNN, B-tree for filters)
--  4. Functions (Haversine distance, semantic search, duplicate detection,
--               similar cases, multi-query item recommendation)
--  5. Application role (least privilege)
--
-- What is stored: 384-dimensional sentence embeddings produced by the
-- all-MiniLM-L6-v2 model (run locally in Node.js). Vectors are L2-normalised,
-- so the cosine distance operator <=> is used and similarity = 1 - distance.
-- MySQL stays the system of record; these rows are derived data and can be
-- rebuilt at any time with `npm run seed:vectors`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Database + extension
-- ---------------------------------------------------------------------
DROP DATABASE IF EXISTS relief_vectors;
CREATE DATABASE relief_vectors;
\connect relief_vectors

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------

-- One row per SOS report (sos_id = MySQL VICTIM_SOS.sos_id)
CREATE TABLE sos_embeddings (
    sos_id        INTEGER PRIMARY KEY,
    embedding     vector(384)  NOT NULL,
    urgency       VARCHAR(20)  NOT NULL CHECK (urgency IN ('low','medium','high','critical')),
    status        VARCHAR(20)  NOT NULL CHECK (status IN ('unmatched','matched','resolved')),
    people_count  INTEGER      NOT NULL CHECK (people_count > 0),
    reported_at   TIMESTAMPTZ  NOT NULL,
    lat           DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
    lon           DOUBLE PRECISION CHECK (lon BETWEEN -180 AND 180),
    disaster_type VARCHAR(30),
    source_text   TEXT         NOT NULL,          -- the exact text that was embedded
    model         VARCHAR(80)  NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2',
    embedded_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK ((lat IS NULL) = (lon IS NULL))
);

-- One row per relief item (item_id = MySQL RESOURCE_ITEM.item_id)
CREATE TABLE item_embeddings (
    item_id      INTEGER PRIMARY KEY,
    embedding    vector(384)  NOT NULL,
    item_name    VARCHAR(120) NOT NULL,
    category     VARCHAR(50)  NOT NULL,
    unit         VARCHAR(20)  NOT NULL,
    source_text  TEXT         NOT NULL,
    model        VARCHAR(80)  NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2',
    embedded_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------
-- HNSW = approximate nearest-neighbour graph index; vector_cosine_ops
-- makes it serve ORDER BY embedding <=> query  (cosine distance)
CREATE INDEX idx_sos_emb_hnsw  ON sos_embeddings  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_item_emb_hnsw ON item_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- B-tree indexes for the metadata filters used with vector search
CREATE INDEX idx_sos_emb_status_time ON sos_embeddings (status, reported_at);
CREATE INDEX idx_sos_emb_urgency     ON sos_embeddings (urgency);
CREATE INDEX idx_item_emb_category   ON item_embeddings (category);

-- ---------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------

-- Great-circle distance in km (same formula as MySQL fn_distance_km)
CREATE OR REPLACE FUNCTION km_between(lat1 float8, lon1 float8, lat2 float8, lon2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT 6371 * 2 * asin(sqrt(
             power(sin(radians(lat2 - lat1) / 2), 2) +
             cos(radians(lat1)) * cos(radians(lat2)) *
             power(sin(radians(lon2 - lon1) / 2), 2)));
$$;

-- (a) Semantic search: top-k SOS by cosine similarity, optional status filter
--     p_status: NULL/'all' = everything, 'open' = not resolved, else exact status
CREATE OR REPLACE FUNCTION search_sos(p_query vector(384), p_k int, p_status text, p_min_sim float8)
RETURNS TABLE (sos_id int, similarity float8)
LANGUAGE sql STABLE AS $$
    SELECT s.sos_id, 1 - (s.embedding <=> p_query) AS similarity
      FROM sos_embeddings s
     WHERE (p_status IS NULL OR p_status = 'all'
            OR (p_status = 'open' AND s.status <> 'resolved')
            OR s.status = p_status)
       AND 1 - (s.embedding <=> p_query) >= p_min_sim
     ORDER BY s.embedding <=> p_query
     LIMIT p_k;
$$;

-- (b) Duplicate detection: similar text AND within radius AND recent AND still open
CREATE OR REPLACE FUNCTION find_duplicate_sos(
    p_query vector(384), p_lat float8, p_lon float8,
    p_radius_km float8, p_hours int, p_min_sim float8, p_k int)
RETURNS TABLE (sos_id int, similarity float8, distance_km float8, urgency varchar, status varchar,
               people_count int, source_text text)
LANGUAGE sql STABLE AS $$
    SELECT s.sos_id,
           1 - (s.embedding <=> p_query)            AS similarity,
           km_between(s.lat, s.lon, p_lat, p_lon)   AS distance_km,
           s.urgency, s.status, s.people_count, s.source_text
      FROM sos_embeddings s
     WHERE s.status <> 'resolved'
       AND s.reported_at >= now() - make_interval(hours => p_hours)
       AND s.lat IS NOT NULL
       AND km_between(s.lat, s.lon, p_lat, p_lon) <= p_radius_km
       AND 1 - (s.embedding <=> p_query) >= p_min_sim
     ORDER BY s.embedding <=> p_query
     LIMIT p_k;
$$;

-- (c) Similar cases: neighbours of an SOS's own stored vector
CREATE OR REPLACE FUNCTION similar_sos(p_sos_id int, p_k int, p_min_sim float8)
RETURNS TABLE (sos_id int, similarity float8, urgency varchar, status varchar, people_count int, source_text text)
LANGUAGE sql STABLE AS $$
    WITH me AS (SELECT embedding FROM sos_embeddings WHERE sos_id = p_sos_id)
    SELECT s.sos_id, 1 - (s.embedding <=> me.embedding), s.urgency, s.status, s.people_count, s.source_text
      FROM sos_embeddings s, me
     WHERE s.sos_id <> p_sos_id
       AND 1 - (s.embedding <=> me.embedding) >= p_min_sim
     ORDER BY s.embedding <=> me.embedding
     LIMIT p_k;
$$;

-- (d) Multi-query item recommendation with max-score fusion.
--     p_queries[1] is the SOS description, p_queries[2..] are the individual
--     needs / medical needs / injuries from the MongoDB intake form.
--     For every query vector take its nearest items (LATERAL kNN), then keep
--     each item's best score and the query that produced it.
CREATE OR REPLACE FUNCTION recommend_items(
    p_queries vector(384)[], p_labels text[], p_per_query int,
    p_min_first float8, p_min_rest float8, p_k int)
RETURNS TABLE (item_id int, item_name varchar, category varchar, unit varchar, similarity float8, matched_on text)
LANGUAGE sql STABLE AS $$
    WITH q AS (
        SELECT t.v, t.label, t.ord
          FROM unnest(p_queries, p_labels) WITH ORDINALITY AS t(v, label, ord)
    ),
    hits AS (
        SELECT q.ord, q.label, h.item_id, h.sim
          FROM q
          CROSS JOIN LATERAL (
                SELECT i.item_id, 1 - (i.embedding <=> q.v) AS sim
                  FROM item_embeddings i
                 ORDER BY i.embedding <=> q.v
                 LIMIT p_per_query) h
         WHERE h.sim >= CASE WHEN q.ord = 1 THEN p_min_first ELSE p_min_rest END
    ),
    best AS (
        SELECT DISTINCT ON (hits.item_id) hits.item_id, hits.sim, hits.label
          FROM hits
         ORDER BY hits.item_id, hits.sim DESC
    )
    SELECT i.item_id, i.item_name, i.category, i.unit, b.sim, b.label
      FROM best b JOIN item_embeddings i ON i.item_id = b.item_id
     ORDER BY b.sim DESC
     LIMIT p_k;
$$;

-- ---------------------------------------------------------------------
-- 5. Application role (least privilege: DML on the two tables + EXECUTE)
--    !! Change the password and put the same value in .env.local (PG_PASSWORD)
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'relief_vector_app') THEN
        CREATE ROLE relief_vector_app LOGIN PASSWORD 'CHANGE_ME_VECTOR';
    END IF;
END $$;

REVOKE ALL ON DATABASE relief_vectors FROM PUBLIC;
GRANT CONNECT ON DATABASE relief_vectors TO relief_vector_app;
GRANT USAGE ON SCHEMA public TO relief_vector_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sos_embeddings, item_embeddings TO relief_vector_app;
GRANT EXECUTE ON FUNCTION km_between(float8, float8, float8, float8),
                          search_sos(vector, int, text, float8),
                          find_duplicate_sos(vector, float8, float8, float8, int, float8, int),
                          similar_sos(int, int, float8),
                          recommend_items(vector[], text[], int, float8, float8, int)
      TO relief_vector_app;

-- Quick check
\dt
\di
