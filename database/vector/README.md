# Vector database: PostgreSQL + pgvector

Setup: `psql -U postgres -f database/vector/pgvector_setup.sql` (or let `docker compose up -d` run it on first start).

| Table | Primary key | Vector column | Other columns (indexed in **bold**) |
|---|---|---|---|
| `sos_embeddings` | `sos_id` (= MySQL `VICTIM_SOS.sos_id`) | `embedding vector(384)`: description + needs + disaster type | **status, reported_at**, **urgency**, people_count, lat, lon, disaster_type, source_text, model, embedded_at |
| `item_embeddings` | `item_id` (= MySQL `RESOURCE_ITEM.item_id`) | `embedding vector(384)`: item name + category + usage_notes | **category**, item_name, unit, source_text, model, embedded_at |

* **Model:** `Xenova/all-MiniLM-L6-v2` (sentence-transformers MiniLM, ONNX, quantised), run locally with transformers.js. No API key is needed and nothing leaves the machine.
* **Vectors:** 384 dimensions, mean pooling, L2-normalised.
* **Metric:** cosine distance, operator `<=>`; similarity = `1 - (a <=> b)`.
* **Index:** HNSW (`USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`) for approximate kNN. B-tree indexes serve the metadata filters.
* **Source of truth:** MySQL. These rows are derived data, and `npm run seed:vectors` (or `-- --recreate`) rebuilds them. Status and urgency changes in MySQL are mirrored with an `UPDATE`.
* **Security:** the app connects as `relief_vector_app`, which has only DML on the two tables and EXECUTE on the functions. It cannot run DDL (test TC22).

## SQL functions (all retrieval logic lives in the database)

| Function | Used by | What it does |
|---|---|---|
| `search_sos(q, k, status, min_sim)` | Semantic search page | `ORDER BY embedding <=> q LIMIT k` with an optional status filter |
| `find_duplicate_sos(q, lat, lon, radius_km, hours, min_sim, k)` | New SOS form | similarity ≥ 0.55 **and** `km_between(...) ≤ 3` **and** `reported_at ≥ now() - 72 h` **and** not resolved |
| `similar_sos(sos_id, k, min_sim)` | SOS page | neighbours of the SOS's own stored vector, excluding itself |
| `recommend_items(q[], labels[], per_query, min_first, min_rest, k)` | SOS page | **multi-query** retrieval: a `LATERAL` kNN per query vector (description + each need / medical need / injury), then `DISTINCT ON (item_id)` keeps each item's best score (max-fusion). The app then calls MySQL `sp_nearest_stock` for every item. |
| `km_between(lat1, lon1, lat2, lon2)` | duplicates | Haversine distance, the same formula as MySQL `fn_distance_km` |

## Try it in psql

```sql
\c relief_vectors
SELECT sos_id, vector_dims(embedding), status, left(source_text, 50) FROM sos_embeddings ORDER BY sos_id;

-- the five reports most similar to SOS #4
SELECT sos_id, round((1 - (embedding <=> (SELECT embedding FROM sos_embeddings WHERE sos_id = 4)))::numeric, 3) AS similarity
  FROM sos_embeddings ORDER BY embedding <=> (SELECT embedding FROM sos_embeddings WHERE sos_id = 4) LIMIT 5;

-- prove the HNSW index is used (the demo table is tiny, so turn seq scans off)
SET enable_seqscan = off;
EXPLAIN SELECT sos_id FROM sos_embeddings ORDER BY embedding <=> (SELECT embedding FROM sos_embeddings WHERE sos_id = 4) LIMIT 5;
--   ->  Index Scan using idx_sos_emb_hnsw on sos_embeddings   Order By: (embedding <=> $0)
```

Free-text queries need an embedding first, so use the app (`/search`) or `GET /api/search?q=...` for those.
