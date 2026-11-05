-- =====================================================================
-- Disaster Response & Smart Relief Logistics Engine
-- G24 - Sem: 5 | Sec: H
-- Team Member 1: Name: Shreya C Rao | SRN: PES2UG24CS481
-- Team Member 2: Name: Shriya C Rao | SRN: PES2UG24CS496
--
-- PART 3: Application integration layer
--   Run AFTER 01_ddl.sql and 02_dml_advanced.sql
--
--  1. ALTER  - item usage notes (source text for vector embeddings)
--  2. VIEWS  - extra read models used by the Next.js API
--  3. PROCEDURES - nearest-stock lookup (hybrid vector + SQL matching),
--                  resolve SOS, cancel reservation
--  4. ROLES  - extra privileges the app needs (least privilege)
--  5. APP DB USERS - one MySQL login per application role
-- =====================================================================

USE disaster_relief;

-- ---------------------------------------------------------------------
-- 1. ALTER: usage notes for every relief item
--    These sentences describe WHEN an item is needed. They are embedded
--    into the vector database (PostgreSQL + pgvector, table item_embeddings) so a
--    free-text SOS like "kid is burning up" can be matched to
--    "Paracetamol Tablets" even though no keyword overlaps.
-- ---------------------------------------------------------------------
ALTER TABLE RESOURCE_ITEM
    ADD COLUMN usage_notes VARCHAR(500) NULL AFTER unit;

UPDATE RESOURCE_ITEM SET usage_notes = CASE item_name
    WHEN 'Drinking Water'      THEN 'Safe drinking water for people cut off by floods, thirst, dehydration, contaminated water supply, heat'
    WHEN 'Rice'                THEN 'Staple food ration for families with no food, hunger, community kitchen, several days of meals'
    WHEN 'Blankets'            THEN 'Warmth for people who are cold, wet, sleeping outdoors or in a shelter, elderly and children at night'
    WHEN 'First Aid Kit'       THEN 'Bandages and antiseptic for injuries, cuts, wounds, fractures, bleeding, sprains, minor burns'
    WHEN 'Paracetamol Tablets' THEN 'Medicine for fever, high temperature, headache, body pain, flu-like illness'
    WHEN 'Baby Food'           THEN 'Nutrition for infants, babies and toddlers, formula milk, young children who cannot eat regular food'
    WHEN 'Tarpaulin Sheets'    THEN 'Waterproof cover for damaged roofs, collapsed houses, temporary shelter, rain protection, landslide'
    WHEN 'Sanitary Kit'        THEN 'Hygiene supplies, sanitary pads, soap, toothbrush, sanitation in camps, women and girls'
    ELSE usage_notes END;

-- ---------------------------------------------------------------------
-- 2. VIEWS used by the application
-- ---------------------------------------------------------------------

-- Every (shelter, item) stock line with shelter location and bed count.
-- Field volunteers get SELECT on this view instead of the base tables.
CREATE OR REPLACE VIEW v_shelter_item_stock AS
SELECT sh.shelter_id, sh.name AS shelter_name, sh.status AS shelter_status,
       sh.lat_long, sh.capacity - sh.current_occupancy AS free_beds,
       r.item_id, r.item_name, r.category, r.unit,
       st.stock_id, st.quantity_available, st.reorder_threshold, st.last_updated
FROM STOCK st
JOIN SHELTER sh      ON sh.shelter_id = st.shelter_id
JOIN RESOURCE_ITEM r ON r.item_id     = st.item_id;

-- Shelter directory (adds location/address to v_shelter_status) for the map/list screens
CREATE OR REPLACE VIEW v_shelter_directory AS
SELECT shelter_id, name, address, lat_long, capacity, current_occupancy,
       fn_shelter_free_beds(shelter_id) AS free_beds,
       ROUND(100 * current_occupancy / NULLIF(capacity, 0), 1) AS occupancy_pct,
       status
FROM SHELTER;

-- Reservation lines with everything the dispatch board needs
CREATE OR REPLACE VIEW v_reservation_detail AS
SELECT sr.reservation_id, sr.status, sr.created_at, sr.quantity_reserved,
       COALESCE((SELECT SUM(d.quantity_dispatched) FROM DISTRIBUTION_LOG d
                  WHERE d.reservation_id = sr.reservation_id
                    AND d.status <> 'cancelled'), 0)        AS quantity_dispatched,
       r.item_id, r.item_name, r.unit, r.category,
       sh.shelter_id, sh.name AS shelter_name,
       v.sos_id, v.urgency_level, fn_urgency_rank(v.urgency_level) AS priority_rank,
       v.status AS sos_status, v.people_count
FROM SUPPLY_RESERVATION sr
JOIN RESOURCE_ITEM r ON r.item_id = sr.item_id
JOIN SHELTER sh      ON sh.shelter_id = sr.shelter_id
JOIN VICTIM_SOS v    ON v.sos_id = sr.sos_id;

-- Per-volunteer field activity (who is logging SOS reports)
CREATE OR REPLACE VIEW v_volunteer_activity AS
SELECT u.user_id, u.name, u.role, sh.name AS home_shelter,
       COUNT(v.sos_id)                               AS sos_reported,
       SUM(v.status = 'resolved')                    AS sos_resolved,
       COALESCE(SUM(v.people_count), 0)              AS people_reported,
       MAX(v.reported_at)                            AS last_report_at
FROM APP_USER u
LEFT JOIN SHELTER sh   ON sh.shelter_id = u.shelter_id
LEFT JOIN VICTIM_SOS v ON v.reported_by = u.user_id
GROUP BY u.user_id, u.name, u.role, sh.name;

-- ---------------------------------------------------------------------
-- 3. PROCEDURES
-- ---------------------------------------------------------------------
DELIMITER $$

-- Hybrid matching, SQL half: for an item picked by vector search, list the
-- active shelters that hold enough of it, nearest first.
DROP PROCEDURE IF EXISTS sp_nearest_stock$$
CREATE PROCEDURE sp_nearest_stock(
    IN p_item_id  INT,
    IN p_lat_long VARCHAR(60),
    IN p_min_qty  INT,
    IN p_limit    INT)
BEGIN
    SELECT st.shelter_id, sh.name AS shelter_name, st.quantity_available,
           r.item_name, r.unit,
           ROUND(fn_distance_km(sh.lat_long, p_lat_long), 2) AS distance_km
      FROM STOCK st
      JOIN SHELTER sh      ON sh.shelter_id = st.shelter_id
      JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
     WHERE st.item_id = p_item_id
       AND sh.status <> 'closed'
       AND st.quantity_available >= GREATEST(p_min_qty, 1)
     ORDER BY (fn_distance_km(sh.lat_long, p_lat_long) IS NULL),
              fn_distance_km(sh.lat_long, p_lat_long),
              st.quantity_available DESC
     LIMIT p_limit;
END$$

-- Resolve an SOS (triggers free the beds and release pending reservations)
DROP PROCEDURE IF EXISTS sp_resolve_sos$$
CREATE PROCEDURE sp_resolve_sos(IN p_sos_id INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    UPDATE VICTIM_SOS SET status = 'resolved'
     WHERE sos_id = p_sos_id AND status <> 'resolved';
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'SOS not found or already resolved';
    END IF;
    COMMIT;
END$$

-- Cancel an open reservation (trigger returns the stock)
DROP PROCEDURE IF EXISTS sp_cancel_reservation$$
CREATE PROCEDURE sp_cancel_reservation(IN p_reservation_id INT)
BEGIN
    DECLARE v_active INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SELECT COUNT(*) INTO v_active
      FROM DISTRIBUTION_LOG
     WHERE reservation_id = p_reservation_id AND status = 'dispatched';
    IF v_active > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Reservation has a vehicle on the road; cancel the dispatch first';
    END IF;

    UPDATE SUPPLY_RESERVATION SET status = 'cancelled'
     WHERE reservation_id = p_reservation_id AND status IN ('pending', 'committed');
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Reservation not found or already closed';
    END IF;
    COMMIT;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------
-- 4. ROLE PRIVILEGES (extends section 16 of part 2)
-- ---------------------------------------------------------------------
-- Coordinator: may remove spam SOS (trigger still blocks active ones)
-- and purge cancelled dispatch rows
GRANT DELETE ON disaster_relief.VICTIM_SOS       TO 'relief_coordinator';
GRANT DELETE ON disaster_relief.DISTRIBUTION_LOG TO 'relief_coordinator';

-- Field volunteer: read-only views + the procedures their screens call.
-- Procedures run with DEFINER rights, so the volunteer never gets direct
-- UPDATE access on SHELTER / STOCK.
GRANT SELECT  ON disaster_relief.v_shelter_item_stock    TO 'field_volunteer';
GRANT SELECT  ON disaster_relief.v_shelter_directory     TO 'field_volunteer';
GRANT SELECT  ON disaster_relief.v_reservation_detail    TO 'field_volunteer';
GRANT SELECT  ON disaster_relief.v_item_stock_summary    TO 'field_volunteer';
GRANT SELECT  ON disaster_relief.RESOURCE_ITEM           TO 'field_volunteer';
GRANT EXECUTE ON PROCEDURE disaster_relief.sp_match_sos      TO 'field_volunteer';
GRANT EXECUTE ON PROCEDURE disaster_relief.sp_nearest_stock  TO 'field_volunteer';
GRANT EXECUTE ON FUNCTION  disaster_relief.fn_distance_km    TO 'field_volunteer';
GRANT EXECUTE ON FUNCTION  disaster_relief.fn_urgency_rank   TO 'field_volunteer';

-- ---------------------------------------------------------------------
-- 5. APPLICATION DATABASE USERS
--    The Next.js API opens a separate connection pool per role, so the
--    database itself enforces what each signed-in role can do.
--    !! Replace the passwords below and put the SAME values in .env.local
--    (MYSQL_AUTH_PASSWORD, MYSQL_COORD_PASSWORD, MYSQL_VOL_PASSWORD).
--    The passwords never appear in the application source code.
-- ---------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'relief_auth'@'%' IDENTIFIED BY 'CHANGE_ME_AUTH';
CREATE USER IF NOT EXISTS 'relief_coord_app'@'%' IDENTIFIED BY 'CHANGE_ME_COORD';
CREATE USER IF NOT EXISTS 'relief_vol_app'@'%' IDENTIFIED BY 'CHANGE_ME_VOL';

-- Login lookups only: read users + shelter names, nothing else
GRANT SELECT ON disaster_relief.APP_USER TO 'relief_auth'@'%';
GRANT SELECT ON disaster_relief.SHELTER  TO 'relief_auth'@'%';

GRANT 'relief_coordinator' TO 'relief_coord_app'@'%';
GRANT 'field_volunteer'    TO 'relief_vol_app'@'%';
SET DEFAULT ROLE ALL TO 'relief_coord_app'@'%', 'relief_vol_app'@'%';

FLUSH PRIVILEGES;

-- Quick check
SHOW GRANTS FOR 'relief_vol_app'@'%' USING 'field_volunteer';
SELECT item_id, item_name, usage_notes FROM RESOURCE_ITEM;
CALL sp_nearest_stock(4, '13.0900,77.5900', 1, 3);
