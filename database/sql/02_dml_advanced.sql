-- =====================================================================
-- Disaster Response & Smart Relief Logistics Engine
-- G24 - Sem: 5 | Sec: H
-- Team Member 1: Name: Shreya C Rao | SRN: PES2UG24CS481   
-- Team Member 2: Name: Shriya C Rao | SRN: PES2UG24CS496 

-- PART 2: ALTER, DML, Queries, Views, Functions, Procedures, Triggers,
--         Transactions, Full-text search, Indexing, Roles

--
-- SECTIONS
--  1. ALTER (extra columns, CHECK constraints, FULLTEXT) + STOCK_ALERT table
--  2. INSERT  - sample data
--  3. Functions
--  4. Triggers
--  5. Stored procedures (transactions, cursor, error handling)
--  6. Views
--  7. Workflow demo (reserve -> dispatch -> deliver)
--  8. SELECT queries (JOIN, GROUP BY, HAVING, subqueries, CTE, window...)
--  9. Full-text search
-- 10. UPDATE
-- 11. Smart matching (procedures)
-- 12. DELETE
-- 13. Explicit transactions (COMMIT / ROLLBACK / SAVEPOINT)
-- 14. Validation tests (run one at a time - each is MEANT to fail)
-- 15. Indexing + EXPLAIN
-- 16. Roles / privileges
-- 17. DROP / ALTER demo
-- =====================================================================

USE disaster_relief;
SET SQL_SAFE_UPDATES = 0;   


-- 1. ALTER  (extra attributes, DB-level validation, full-text indexes)

-- SOS needs a free-text description (for full-text search), a head-count
-- (to update shelter occupancy) and a location (for nearest-shelter matching)
ALTER TABLE VICTIM_SOS
    ADD COLUMN description TEXT AFTER intake_doc_ref,
    ADD COLUMN people_count INT NOT NULL DEFAULT 1 AFTER description,
    ADD COLUMN lat_long VARCHAR(60) AFTER people_count,
    ADD CONSTRAINT chk_sos_people CHECK (people_count > 0);

-- Input validation at database level
ALTER TABLE APP_USER
    ADD CONSTRAINT chk_user_email
        CHECK (email REGEXP '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'),
    ADD CONSTRAINT chk_user_phone
        CHECK (phone IS NULL OR phone REGEXP '^[0-9]{10}$');

-- Full-text indexes
ALTER TABLE VICTIM_SOS ADD FULLTEXT INDEX ft_sos_description (description);
ALTER TABLE RESOURCE_ITEM ADD FULLTEXT INDEX ft_item_name_cat (item_name, category);

-- Extra indexes for the triage dashboard and shelter lookups
CREATE INDEX idx_sos_triage ON VICTIM_SOS(status, urgency_level, reported_at);
CREATE INDEX idx_shelter_status ON SHELTER(status);

-- New table filled automatically by a trigger when stock runs low
CREATE TABLE STOCK_ALERT (
    alert_id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id INT NOT NULL,
    quantity_at_alert INT NOT NULL,
    reorder_threshold INT NOT NULL,
    alert_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_resolved BOOLEAN  NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_alert_stock
        FOREIGN KEY (stock_id) REFERENCES STOCK(stock_id)
        ON DELETE CASCADE
);

-- 2. INSERT - sample data (inserted BEFORE triggers exist, so the
-- initial numbers below are taken as-is)

INSERT INTO SHELTER (name, address, capacity, current_occupancy, status, lat_long) VALUES
('Banashankari Community Hall', 'Banashankari 3rd Stage, Bengaluru', 150, 40, 'active', '12.9255,77.5468'),
('Koramangala Indoor Stadium', 'Koramangala 4th Block, Bengaluru', 300, 120, 'active', '12.9352,77.6245'),
('Whitefield Government School', 'ITPL Main Road, Whitefield', 120, 120, 'full', '12.9698,77.7500'),
('Yelahanka Relief Centre', 'Yelahanka New Town, Bengaluru', 200, 50, 'active', '13.1007,77.5963'),
('Jayanagar Municipal Hall', 'Jayanagar 4th Block, Bengaluru', 80, 10, 'active', '12.9250,77.5938');

INSERT INTO RESOURCE_ITEM (item_name, category, unit) VALUES
('Drinking Water', 'Water', 'litre'),
('Rice', 'Food', 'kg'),
('Blankets', 'Shelter', 'piece'),
('First Aid Kit', 'Medical', 'kit'),
('Paracetamol Tablets','Medical','strip'),
('Baby Food', 'Food', 'pack'),
('Tarpaulin Sheets', 'Shelter', 'piece'),
('Sanitary Kit', 'Hygiene', 'kit');

INSERT INTO LOGISTICS_VEHICLE (registration_no, type, status, capacity_kg) VALUES
('KA-01-AB-1234', 'Truck', 'available', 3000.00),
('KA-05-CD-5678', 'Mini Truck', 'available', 1200.00),
('KA-03-EF-9012', 'Ambulance', 'available', 400.00),
('KA-02-GH-3456', 'Tempo', 'maintenance', 800.00),
('KA-04-IJ-7890', 'Truck', 'in_transit', 2500.00);

-- NOTE: these are placeholder strings. In the Next.js app, store a real
-- bcrypt hash (bcrypt.hash(password, 10)) - never a plain-text password.
INSERT INTO APP_USER (name, role, email, phone, password_hash, shelter_id) VALUES
('Ananya Sharma', 'Relief Coordinator', 'ananya.sharma@relief.org', '9876500001', '$2b$10$placeholderHashAnanya000000000000000000000000000000000', 1),
('Rohit Verma', 'Relief Coordinator', 'rohit.verma@relief.org', '9876500002', '$2b$10$placeholderHashRohit0000000000000000000000000000000000', 2),
('Meera Iyer', 'Field Volunteer', 'meera.iyer@relief.org', '9876500003', '$2b$10$placeholderHashMeera0000000000000000000000000000000000', 1),
('Karthik Nair', 'Field Volunteer', 'karthik.nair@relief.org', '9876500004', '$2b$10$placeholderHashKarthik00000000000000000000000000000000', 2),
('Farhan Ali', 'Field Volunteer', 'farhan.ali@relief.org', '9876500005', '$2b$10$placeholderHashFarhan000000000000000000000000000000000', 4),
('Divya Reddy', 'Field Volunteer', 'divya.reddy@relief.org', '9876500006', '$2b$10$placeholderHashDivya0000000000000000000000000000000000', 3);

INSERT INTO STOCK (item_id, shelter_id, quantity_available, reorder_threshold) VALUES
-- Shelter 1
(1,1,500,100),(2,1,200,50),(3,1,80,30),(4,1,25,10),(5,1,60,20),
-- Shelter 2
(1,2,800,150),(2,2,350,80),(3,2,150,40),(4,2,40,15),(5,2,15,20),(6,2,30,10),(8,2,100,30),
-- Shelter 3
(1,3,300,100),(3,3,60,20),(7,3,50,20),
-- Shelter 4
(1,4,600,120),(2,4,400,100),(3,4,200,50),(4,4,30,10),(7,4,90,30),(8,4,12,25),
-- Shelter 5
(1,5,100,50),(3,5,25,30);

INSERT INTO VICTIM_SOS
 (urgency_level, status, reported_at, intake_doc_ref, description, people_count, lat_long, reported_by, matched_shelter_id)
VALUES
('critical','matched', NOW() - INTERVAL 3  HOUR, 'intake/sos_001.pdf',
 'Family of five stranded on rooftop as flood water rises; infant needs baby food and fever medicines', 5, '12.9330,77.6200', 3, 2),
('high', 'matched', NOW() - INTERVAL 5  HOUR, 'intake/sos_002.pdf',
 'Elderly couple with limited mobility need drinking water and regular medicines after flooding', 2, '12.9260,77.5500', 3, 1),
('medium', 'unmatched', NOW() - INTERVAL 30 HOUR, NULL,
 'Landslide blocked the village road; residents need tarpaulin sheets and blankets', 6, '13.0500,77.6000', 4, NULL),
('critical','unmatched', NOW() - INTERVAL 1  HOUR, 'intake/sos_004.pdf',
 'Child with high fever and leg injury needs first aid kit and an ambulance', 3, '13.0900,77.5900', 5, NULL),
('low', 'unmatched', NOW() - INTERVAL 50 HOUR, NULL,
 'Need drinking water and rice for two days', 2, '12.9300,77.5900', 3, NULL),
('high', 'unmatched', NOW() - INTERVAL 14 HOUR, 'intake/sos_006.pdf',
 'Flooded apartment block with ten residents needing shelter and blankets', 10, '12.9300,77.6200', 4, NULL),
('medium', 'resolved', NOW() - INTERVAL 40 HOUR, NULL,
 'Power outage at hospital annex; sanitary kits needed', 8, '13.1000,77.5900', 5, 4),
('high', 'unmatched', NOW() - INTERVAL 2  HOUR, 'intake/sos_008.pdf',
 'Pregnant woman and three children trapped by flood; urgent medical support needed', 4, '12.9700,77.7400', 6, NULL);

-- 3. FUNCTIONS

DELIMITER $$

-- Free beds in a shelter
CREATE FUNCTION fn_shelter_free_beds(p_shelter_id INT)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_free INT;
    SELECT capacity - current_occupancy INTO v_free
      FROM SHELTER WHERE shelter_id = p_shelter_id;
    RETURN v_free;
END$$

-- Numeric priority for urgency levels (higher = more urgent)
CREATE FUNCTION fn_urgency_rank(p_level VARCHAR(20))
RETURNS INT
DETERMINISTIC NO SQL
BEGIN
    RETURN CASE p_level
              WHEN 'critical' THEN 4
              WHEN 'high' THEN 3
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 1
              ELSE 0
           END;
END$$

-- Haversine distance (km) between two 'lat,long' strings
CREATE FUNCTION fn_distance_km(p1 VARCHAR(60), p2 VARCHAR(60))
RETURNS DOUBLE
DETERMINISTIC NO SQL
BEGIN
    DECLARE lat1, lon1, lat2, lon2 DOUBLE;
    IF p1 IS NULL OR p2 IS NULL THEN
        RETURN NULL;
    END IF;
    SET lat1 = CAST(TRIM(SUBSTRING_INDEX(p1, ',', 1))  AS DECIMAL(10,6));
    SET lon1 = CAST(TRIM(SUBSTRING_INDEX(p1, ',', -1)) AS DECIMAL(10,6));
    SET lat2 = CAST(TRIM(SUBSTRING_INDEX(p2, ',', 1))  AS DECIMAL(10,6));
    SET lon2 = CAST(TRIM(SUBSTRING_INDEX(p2, ',', -1)) AS DECIMAL(10,6));
    RETURN 6371 * 2 * ASIN(SQRT(
              POW(SIN(RADIANS(lat2 - lat1) / 2), 2) +
              COS(RADIANS(lat1)) * COS(RADIANS(lat2)) *
              POW(SIN(RADIANS(lon2 - lon1) / 2), 2)));
END$$

-- 4. TRIGGERS

-- SHELTER: keep status in sync with occupancy 
CREATE TRIGGER trg_shelter_bi
BEFORE INSERT ON SHELTER FOR EACH ROW
BEGIN
    IF NEW.status <> 'closed' THEN
        SET NEW.status = IF(NEW.current_occupancy >= NEW.capacity, 'full', 'active');
    END IF;
END$$

CREATE TRIGGER trg_shelter_bu
BEFORE UPDATE ON SHELTER FOR EACH ROW
BEGIN
    IF NEW.status = 'closed' AND OLD.status <> 'closed' AND NEW.current_occupancy > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot close a shelter that still has occupants';
    END IF;
    IF NEW.status <> 'closed' THEN
        SET NEW.status = IF(NEW.current_occupancy >= NEW.capacity, 'full', 'active');
    END IF;
END$$

-- STOCK: timestamp + low-stock alerts
CREATE TRIGGER trg_stock_bu
BEFORE UPDATE ON STOCK FOR EACH ROW
BEGIN
    SET NEW.last_updated = NOW();
END$$

CREATE TRIGGER trg_stock_au
AFTER UPDATE ON STOCK FOR EACH ROW
BEGIN
    -- stock dropped to/below threshold -> raise an alert
    IF NEW.quantity_available < OLD.quantity_available
       AND NEW.quantity_available <= NEW.reorder_threshold THEN
        INSERT INTO STOCK_ALERT (stock_id, quantity_at_alert, reorder_threshold)
        VALUES (NEW.stock_id, NEW.quantity_available, NEW.reorder_threshold);
    END IF;
    -- stock back above threshold -> close open alerts
    IF NEW.quantity_available > NEW.reorder_threshold THEN
        UPDATE STOCK_ALERT SET is_resolved = TRUE
         WHERE stock_id = NEW.stock_id AND is_resolved = FALSE;
    END IF;
END$$

-- SUPPLY_RESERVATION: reserve / release stock automatically 
CREATE TRIGGER trg_reservation_bi
BEFORE INSERT ON SUPPLY_RESERVATION FOR EACH ROW
BEGIN
    DECLARE v_avail INT;
    DECLARE v_sos_status VARCHAR(20);

    SELECT status INTO v_sos_status FROM VICTIM_SOS WHERE sos_id = NEW.sos_id;
    IF v_sos_status = 'resolved' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot reserve supplies for a resolved SOS';
    END IF;

    SELECT quantity_available INTO v_avail
      FROM STOCK
     WHERE item_id = NEW.item_id AND shelter_id = NEW.shelter_id
       FOR UPDATE;                                   -- row lock

    IF v_avail IS NULL OR v_avail < NEW.quantity_reserved THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Insufficient stock at this shelter for the requested reservation';
    END IF;
END$$

CREATE TRIGGER trg_reservation_ai
AFTER INSERT ON SUPPLY_RESERVATION FOR EACH ROW
BEGIN
    IF NEW.status IN ('pending', 'committed') THEN
        UPDATE STOCK
           SET quantity_available = quantity_available - NEW.quantity_reserved
         WHERE item_id = NEW.item_id AND shelter_id = NEW.shelter_id;
    END IF;
END$$

CREATE TRIGGER trg_reservation_bu
BEFORE UPDATE ON SUPPLY_RESERVATION FOR EACH ROW
BEGIN
    IF OLD.status IN ('cancelled', 'fulfilled') AND NEW.status <> OLD.status THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cancelled/fulfilled reservations cannot change status';
    END IF;
    IF NEW.quantity_reserved <> OLD.quantity_reserved
       OR NEW.item_id <> OLD.item_id OR NEW.shelter_id <> OLD.shelter_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Reservation details are immutable; cancel and create a new one';
    END IF;
END$$

CREATE TRIGGER trg_reservation_au
AFTER UPDATE ON SUPPLY_RESERVATION FOR EACH ROW
BEGIN
    -- cancelling releases the reserved quantity back to stock
    IF NEW.status = 'cancelled' AND OLD.status IN ('pending', 'committed') THEN
        UPDATE STOCK
           SET quantity_available = quantity_available + OLD.quantity_reserved
         WHERE item_id = OLD.item_id AND shelter_id = OLD.shelter_id;
    END IF;
END$$

-- DISTRIBUTION_LOG: validate dispatch + keep related rows in sync
CREATE TRIGGER trg_distribution_bi
BEFORE INSERT ON DISTRIBUTION_LOG FOR EACH ROW
BEGIN
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_res_qty INT;
    DECLARE v_already INT;
    DECLARE v_veh_status VARCHAR(20);
    DECLARE v_role VARCHAR(30);

    SELECT status, quantity_reserved INTO v_res_status, v_res_qty
      FROM SUPPLY_RESERVATION WHERE reservation_id = NEW.reservation_id;
    IF v_res_status IS NULL OR v_res_status NOT IN ('pending', 'committed') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Reservation is not open for dispatch';
    END IF;

    SELECT COALESCE(SUM(quantity_dispatched), 0) INTO v_already
      FROM DISTRIBUTION_LOG
     WHERE reservation_id = NEW.reservation_id AND status <> 'cancelled';
    IF v_already + NEW.quantity_dispatched > v_res_qty THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Dispatch quantity exceeds the reserved quantity';
    END IF;

    IF NEW.vehicle_id IS NOT NULL THEN
        SELECT status INTO v_veh_status
          FROM LOGISTICS_VEHICLE WHERE vehicle_id = NEW.vehicle_id;
        IF v_veh_status <> 'available' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Vehicle is not available for dispatch';
        END IF;
    END IF;

    SELECT role INTO v_role FROM APP_USER WHERE user_id = NEW.approved_by;
    IF v_role IS NULL OR v_role <> 'Relief Coordinator' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only a Relief Coordinator can approve a dispatch';
    END IF;
END$$

CREATE TRIGGER trg_distribution_ai
AFTER INSERT ON DISTRIBUTION_LOG FOR EACH ROW
BEGIN
    UPDATE SUPPLY_RESERVATION SET status = 'committed'
     WHERE reservation_id = NEW.reservation_id AND status = 'pending';
    IF NEW.vehicle_id IS NOT NULL THEN
        UPDATE LOGISTICS_VEHICLE SET status = 'in_transit'
         WHERE vehicle_id = NEW.vehicle_id;
    END IF;
END$$

CREATE TRIGGER trg_distribution_bu
BEFORE UPDATE ON DISTRIBUTION_LOG FOR EACH ROW
BEGIN
    IF OLD.status <> 'dispatched' AND NEW.status <> OLD.status THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Delivered/cancelled dispatches cannot change status';
    END IF;
END$$

CREATE TRIGGER trg_distribution_au
AFTER UPDATE ON DISTRIBUTION_LOG FOR EACH ROW
BEGIN
    DECLARE v_total_qty INT;
    DECLARE v_delivered INT;
    DECLARE v_active    INT;

    IF OLD.status = 'dispatched' AND NEW.status IN ('delivered', 'cancelled') THEN
        -- free the vehicle
        IF NEW.vehicle_id IS NOT NULL THEN
            UPDATE LOGISTICS_VEHICLE SET status = 'available'
             WHERE vehicle_id = NEW.vehicle_id;
        END IF;

        SELECT quantity_reserved INTO v_total_qty
          FROM SUPPLY_RESERVATION WHERE reservation_id = NEW.reservation_id;

        IF NEW.status = 'delivered' THEN
            SELECT COALESCE(SUM(quantity_dispatched), 0) INTO v_delivered
              FROM DISTRIBUTION_LOG
             WHERE reservation_id = NEW.reservation_id AND status = 'delivered';
            IF v_delivered >= v_total_qty THEN
                UPDATE SUPPLY_RESERVATION SET status = 'fulfilled'
                 WHERE reservation_id = NEW.reservation_id;
            END IF;
        ELSE
            -- cancelled dispatch: if nothing else is moving, reservation goes back to pending
            SELECT COUNT(*) INTO v_active
              FROM DISTRIBUTION_LOG
             WHERE reservation_id = NEW.reservation_id
               AND status IN ('dispatched', 'delivered');
            IF v_active = 0 THEN
                UPDATE SUPPLY_RESERVATION SET status = 'pending'
                 WHERE reservation_id = NEW.reservation_id AND status = 'committed';
            END IF;
        END IF;
    END IF;
END$$

-- VICTIM_SOS: status rules, occupancy release, delete guard 
CREATE TRIGGER trg_sos_bu
BEFORE UPDATE ON VICTIM_SOS FOR EACH ROW
BEGIN
    IF OLD.status = 'resolved' AND NEW.status <> 'resolved' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A resolved SOS cannot be re-opened';
    END IF;
    IF NEW.matched_shelter_id IS NOT NULL AND OLD.matched_shelter_id IS NULL
       AND NEW.status = 'unmatched' THEN
        SET NEW.status = 'matched';
    END IF;
END$$

CREATE TRIGGER trg_sos_au
AFTER UPDATE ON VICTIM_SOS FOR EACH ROW
BEGIN
    IF OLD.status <> 'resolved' AND NEW.status = 'resolved' THEN
        -- people leave the shelter
        IF NEW.matched_shelter_id IS NOT NULL THEN
            UPDATE SHELTER
               SET current_occupancy = GREATEST(current_occupancy - NEW.people_count, 0)
             WHERE shelter_id = NEW.matched_shelter_id;
        END IF;
        -- release stock held by reservations that were never dispatched
        UPDATE SUPPLY_RESERVATION SET status = 'cancelled'
         WHERE sos_id = NEW.sos_id AND status = 'pending';
    END IF;
END$$

CREATE TRIGGER trg_sos_bd
BEFORE DELETE ON VICTIM_SOS FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM SUPPLY_RESERVATION
                WHERE sos_id = OLD.sos_id AND status IN ('pending', 'committed')) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot delete an SOS that has active reservations';
    END IF;
END$$

CREATE TRIGGER trg_sos_ad
AFTER DELETE ON VICTIM_SOS FOR EACH ROW
BEGIN
    IF OLD.status = 'matched' AND OLD.matched_shelter_id IS NOT NULL THEN
        UPDATE SHELTER
           SET current_occupancy = GREATEST(current_occupancy - OLD.people_count, 0)
         WHERE shelter_id = OLD.matched_shelter_id;
    END IF;
END$$

-- 5. STORED PROCEDURES  (transactions, error handling, cursor)

-- Register a new SOS
CREATE PROCEDURE sp_register_sos(
    IN p_reported_by INT,
    IN p_urgency VARCHAR(20),
    IN p_description TEXT,
    IN p_people INT,
    IN p_lat_long VARCHAR(60),
    IN p_intake_doc VARCHAR(255),
    OUT p_sos_id INT)
BEGIN
    INSERT INTO VICTIM_SOS
        (urgency_level, description, people_count, lat_long, intake_doc_ref, reported_by)
    VALUES
        (p_urgency, p_description, p_people, p_lat_long, p_intake_doc, p_reported_by);
    SET p_sos_id = LAST_INSERT_ID();
END$$

-- Match one SOS to the nearest ACTIVE shelter that has enough free beds
CREATE PROCEDURE sp_match_sos(IN p_sos_id INT)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_people INT;
    DECLARE v_ll VARCHAR(60);
    DECLARE v_shelter INT;

    DECLARE CONTINUE HANDLER FOR NOT FOUND BEGIN END;   -- SELECT..INTO with no row = NULL
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status, people_count, lat_long INTO v_status, v_people, v_ll
      FROM VICTIM_SOS WHERE sos_id = p_sos_id FOR UPDATE;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SOS not found';
    END IF;
    IF v_status <> 'unmatched' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SOS is already matched or resolved';
    END IF;

    SELECT shelter_id INTO v_shelter
      FROM SHELTER
     WHERE status = 'active'
       AND capacity - current_occupancy >= v_people
     ORDER BY (fn_distance_km(lat_long, v_ll) IS NULL),
              fn_distance_km(lat_long, v_ll),
              (capacity - current_occupancy) DESC
     LIMIT 1
       FOR UPDATE;

    IF v_shelter IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No active shelter has enough free beds';
    END IF;

    UPDATE SHELTER SET current_occupancy = current_occupancy + v_people
     WHERE shelter_id = v_shelter;                       -- trigger flips status to full if needed
    UPDATE VICTIM_SOS SET matched_shelter_id = v_shelter, status = 'matched'
     WHERE sos_id = p_sos_id;

    COMMIT;
END$$

-- Match ALL unmatched SOS, most urgent first (CURSOR + loop)
CREATE PROCEDURE sp_auto_match_unmatched(OUT p_matched INT, OUT p_failed INT)
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_err INT DEFAULT 0;
    DECLARE v_sos INT;

    DECLARE cur CURSOR FOR
        SELECT sos_id FROM VICTIM_SOS
         WHERE status = 'unmatched'
         ORDER BY fn_urgency_rank(urgency_level) DESC, reported_at ASC;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_err = 1;

    SET p_matched = 0;
    SET p_failed  = 0;

    OPEN cur;
    match_loop: LOOP
        FETCH cur INTO v_sos;
        IF v_done = 1 THEN
            LEAVE match_loop;
        END IF;

        SET v_err = 0;
        CALL sp_match_sos(v_sos);
        IF v_err = 0 THEN
            SET p_matched = p_matched + 1;
        ELSE
            SET p_failed = p_failed + 1;
        END IF;
    END LOOP;
    CLOSE cur;
END$$

-- Reserve supplies for an SOS (transaction; triggers validate + deduct stock)
CREATE PROCEDURE sp_reserve_supply(
    IN p_sos_id INT,
    IN p_item_id INT,
    IN p_shelter_id INT,
    IN p_qty INT,
    OUT p_reservation_id INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    INSERT INTO SUPPLY_RESERVATION (item_id, shelter_id, sos_id, quantity_reserved)
    VALUES (p_item_id, p_shelter_id, p_sos_id, p_qty);
    SET p_reservation_id = LAST_INSERT_ID();
    COMMIT;
END$$

-- Coordinator approves a dispatch
CREATE PROCEDURE sp_approve_dispatch(
    IN p_reservation_id INT,
    IN p_vehicle_id INT,
    IN p_approved_by INT,
    IN p_qty INT,
    OUT p_log_id INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    INSERT INTO DISTRIBUTION_LOG (reservation_id, vehicle_id, approved_by, quantity_dispatched)
    VALUES (p_reservation_id, p_vehicle_id, p_approved_by, p_qty);
    SET p_log_id = LAST_INSERT_ID();
    COMMIT;
END$$

-- Mark a dispatch as delivered
CREATE PROCEDURE sp_complete_delivery(IN p_log_id INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    UPDATE DISTRIBUTION_LOG SET status = 'delivered'
     WHERE log_id = p_log_id AND status = 'dispatched';
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No dispatched log found with this id';
    END IF;
    COMMIT;
END$$

-- Add stock (insert the stock row if the shelter never held the item)
CREATE PROCEDURE sp_restock(IN p_item_id INT, IN p_shelter_id INT, IN p_qty INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_qty <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restock quantity must be positive';
    END IF;

    START TRANSACTION;
    INSERT INTO STOCK (item_id, shelter_id, quantity_available)
    VALUES (p_item_id, p_shelter_id, p_qty)
    ON DUPLICATE KEY UPDATE quantity_available = quantity_available + VALUES(quantity_available);
    COMMIT;
END$$

-- Move stock between two shelters atomically (rows locked in id order -> no deadlock)
CREATE PROCEDURE sp_transfer_stock(
    IN p_item_id INT, IN p_from_shelter INT, IN p_to_shelter INT, IN p_qty INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_from_shelter = p_to_shelter OR p_qty <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Invalid transfer: shelters must differ and quantity must be positive';
    END IF;

    START TRANSACTION;

    SELECT stock_id FROM STOCK
     WHERE item_id = p_item_id AND shelter_id IN (p_from_shelter, p_to_shelter)
     ORDER BY shelter_id
       FOR UPDATE;

    UPDATE STOCK SET quantity_available = quantity_available - p_qty
     WHERE item_id = p_item_id AND shelter_id = p_from_shelter;   -- CHECK(>=0) rolls back if short

    INSERT INTO STOCK (item_id, shelter_id, quantity_available)
    VALUES (p_item_id, p_to_shelter, p_qty)
    ON DUPLICATE KEY UPDATE quantity_available = quantity_available + VALUES(quantity_available);

    COMMIT;
END$$

DELIMITER ;

-- 6. VIEWS

CREATE OR REPLACE VIEW v_shelter_status AS
SELECT shelter_id, name, capacity, current_occupancy,
       capacity - current_occupancy AS free_beds,
       ROUND(100 * current_occupancy / NULLIF(capacity, 0), 1) AS occupancy_pct,
       status
FROM SHELTER;

CREATE OR REPLACE VIEW v_low_stock AS
SELECT st.stock_id, sh.name AS shelter, r.item_name, r.category, r.unit,
       st.quantity_available, st.reorder_threshold,
       st.reorder_threshold - st.quantity_available AS shortfall
FROM STOCK st
JOIN SHELTER sh ON sh.shelter_id = st.shelter_id
JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
WHERE st.quantity_available <= st.reorder_threshold;

CREATE OR REPLACE VIEW v_open_sos_priority AS
SELECT v.sos_id, v.urgency_level, fn_urgency_rank(v.urgency_level) AS priority_rank,
       v.status, v.people_count, v.description,
       TIMESTAMPDIFF(HOUR, v.reported_at, NOW()) AS hours_waiting,
       u.name AS reported_by_name,
       sh.name AS matched_shelter
FROM VICTIM_SOS v
JOIN APP_USER u ON u.user_id = v.reported_by
LEFT JOIN SHELTER sh ON sh.shelter_id = v.matched_shelter_id
WHERE v.status <> 'resolved';

CREATE OR REPLACE VIEW v_dispatch_overview AS
SELECT d.log_id, d.dispatch_time, d.status AS dispatch_status,
       r.item_name, d.quantity_dispatched, r.unit,
       sh.name AS from_shelter,
       lv.registration_no AS vehicle, lv.type AS vehicle_type,
       u.name AS approved_by_name,
       sr.sos_id
FROM DISTRIBUTION_LOG d
JOIN SUPPLY_RESERVATION sr ON sr.reservation_id = d.reservation_id
JOIN RESOURCE_ITEM r ON r.item_id = sr.item_id
JOIN SHELTER sh ON sh.shelter_id = sr.shelter_id
JOIN APP_USER u ON u.user_id = d.approved_by
LEFT JOIN LOGISTICS_VEHICLE lv ON lv.vehicle_id = d.vehicle_id;

CREATE OR REPLACE VIEW v_item_stock_summary AS
SELECT r.item_id, r.item_name, r.category,
       COUNT(st.stock_id) AS shelters_stocking,
       SUM(st.quantity_available) AS total_available
FROM RESOURCE_ITEM r
LEFT JOIN STOCK st ON st.item_id = r.item_id
GROUP BY r.item_id, r.item_name, r.category;

-- 7. WORKFLOW DEMO  (triggers fire now: reserve -> dispatch -> deliver)

-- Reservations (stock is deducted by trigger; low-stock alerts get raised)
CALL sp_reserve_supply(1, 6, 2,  6, @r1);   -- baby food for SOS 1
CALL sp_reserve_supply(1, 5, 2,  5, @r2);   -- paracetamol (15 -> 10, alert)
CALL sp_reserve_supply(2, 1, 1, 30, @r3);   -- water for SOS 2
CALL sp_reserve_supply(3, 7, 4, 40, @r4);   -- tarpaulins for SOS 3
CALL sp_reserve_supply(3, 3, 4, 30, @r5);   -- blankets for SOS 3
CALL sp_reserve_supply(4, 4, 4,  2, @r6);   -- first-aid kits for SOS 4
CALL sp_reserve_supply(6, 8, 4, 10, @r7);   -- sanitary kits (12 -> 2, alert)
CALL sp_reserve_supply(6, 3, 2, 20, @r8);   -- blankets for SOS 6

-- Coordinators approve dispatches (vehicle -> in_transit, reservation -> committed)
CALL sp_approve_dispatch(@r1, 3, 2,  6, @l1);   -- ambulance, Rohit
CALL sp_approve_dispatch(@r3, 1, 1, 30, @l2);   -- truck, Ananya
CALL sp_approve_dispatch(@r4, 2, 2, 40, @l3);   -- mini truck, Rohit

-- First delivery completes (reservation -> fulfilled, ambulance -> available)
CALL sp_complete_delivery(@l1);

-- Direct INSERT also works (same triggers apply)
INSERT INTO DISTRIBUTION_LOG (reservation_id, vehicle_id, approved_by, quantity_dispatched)
VALUES (@r2, 3, 2, 5);

-- Restock through the procedure (resolves the paracetamol alert once above threshold)
CALL sp_restock(5, 2, 40);

-- 8. SELECT QUERIES

-- Q1  Filter + ORDER BY: open critical/high SOS, most urgent & oldest first
SELECT sos_id, urgency_level, status, people_count, reported_at
FROM VICTIM_SOS
WHERE urgency_level IN ('critical', 'high') AND status <> 'resolved'
ORDER BY fn_urgency_rank(urgency_level) DESC, reported_at ASC;

-- Q2  INNER JOIN + LEFT JOIN: SOS with reporter and (optional) shelter
SELECT v.sos_id, v.urgency_level, u.name AS reported_by, u.role,
       COALESCE(s.name, '-- not yet matched --') AS shelter
FROM VICTIM_SOS v
JOIN APP_USER u ON u.user_id = v.reported_by
LEFT JOIN SHELTER s ON s.shelter_id = v.matched_shelter_id
ORDER BY v.sos_id;

-- Q3  GROUP BY + aggregates: SOS load by urgency and status
SELECT urgency_level, status,
       COUNT(*) AS sos_count,
       SUM(people_count) AS people_affected
FROM VICTIM_SOS
GROUP BY urgency_level, status
ORDER BY fn_urgency_rank(urgency_level) DESC, status;

-- Q4  GROUP BY + HAVING: categories with more than 300 units in total
SELECT r.category,
       COUNT(DISTINCT st.shelter_id) AS shelters_stocking,
       SUM(st.quantity_available) AS total_qty
FROM STOCK st
JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
GROUP BY r.category
HAVING SUM(st.quantity_available) > 300
ORDER BY total_qty DESC;

-- Q5  GROUP BY + HAVING: shelters with 2+ open reservations
SELECT sh.name, COUNT(*) AS open_reservations, SUM(sr.quantity_reserved) AS units_held
FROM SUPPLY_RESERVATION sr
JOIN SHELTER sh ON sh.shelter_id = sr.shelter_id
WHERE sr.status IN ('pending', 'committed')
GROUP BY sh.shelter_id, sh.name
HAVING COUNT(*) >= 2
ORDER BY open_reservations DESC;

-- Q6  Multi-table JOIN: full reservation details
SELECT sr.reservation_id, v.urgency_level, r.item_name,
       sr.quantity_reserved, r.unit, sh.name AS supplied_from, sr.status
FROM SUPPLY_RESERVATION sr
JOIN VICTIM_SOS v ON v.sos_id = sr.sos_id
JOIN RESOURCE_ITEM r ON r.item_id = sr.item_id
JOIN SHELTER sh ON sh.shelter_id = sr.shelter_id
ORDER BY fn_urgency_rank(v.urgency_level) DESC, sr.reservation_id;

-- Q7  Scalar subquery: shelters more crowded than the average
SELECT name, current_occupancy, capacity,
       ROUND(100 * current_occupancy / capacity, 1) AS occupancy_pct
FROM SHELTER
WHERE current_occupancy / capacity >
      (SELECT AVG(current_occupancy / capacity) FROM SHELTER WHERE capacity > 0)
ORDER BY occupancy_pct DESC;

-- Q8  Correlated subquery: stock rows below the average for the same item
SELECT sh.name AS shelter, r.item_name, st.quantity_available
FROM STOCK st
JOIN SHELTER sh ON sh.shelter_id = st.shelter_id
JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
WHERE st.quantity_available <
      (SELECT AVG(s2.quantity_available) FROM STOCK s2 WHERE s2.item_id = st.item_id)
ORDER BY r.item_name, st.quantity_available;

-- Q9  NOT EXISTS: open SOS that have no supplies reserved yet
SELECT v.sos_id, v.urgency_level, v.description
FROM VICTIM_SOS v
WHERE v.status <> 'resolved'
  AND NOT EXISTS (SELECT 1 FROM SUPPLY_RESERVATION sr WHERE sr.sos_id = v.sos_id);

-- Q10 NOT IN subquery: vehicles that have never been dispatched
SELECT vehicle_id, registration_no, type, status
FROM LOGISTICS_VEHICLE
WHERE vehicle_id NOT IN (SELECT vehicle_id FROM DISTRIBUTION_LOG WHERE vehicle_id IS NOT NULL);

-- Q11 Window functions: rank shelters by free beds + total sheltered
SELECT name, capacity - current_occupancy AS free_beds,
       RANK() OVER (ORDER BY capacity - current_occupancy DESC) AS free_rank,
       SUM(current_occupancy) OVER () AS total_sheltered
FROM SHELTER;

-- Q12 CTE + ROW_NUMBER: two nearest shelters (with enough beds) for every unmatched SOS
WITH open_sos AS (
    SELECT sos_id, urgency_level, people_count, lat_long
    FROM VICTIM_SOS WHERE status = 'unmatched'
),
candidates AS (
    SELECT o.sos_id, o.urgency_level, s.name AS shelter,
           ROUND(fn_distance_km(o.lat_long, s.lat_long), 2) AS dist_km,
           fn_shelter_free_beds(s.shelter_id) AS free_beds,
           ROW_NUMBER() OVER (PARTITION BY o.sos_id
                              ORDER BY fn_distance_km(o.lat_long, s.lat_long)) AS rn
    FROM open_sos o
    JOIN SHELTER s ON s.status = 'active'
                  AND s.capacity - s.current_occupancy >= o.people_count
)
SELECT sos_id, urgency_level, shelter, dist_km, free_beds, rn AS choice_no
FROM candidates
WHERE rn <= 2
ORDER BY fn_urgency_rank(urgency_level) DESC, sos_id, rn;

-- Q13 LEFT JOIN + GROUP BY + HAVING: supply lines per SOS
SELECT v.sos_id, v.urgency_level,
       COUNT(sr.reservation_id) AS reservation_lines,
       COALESCE(SUM(sr.quantity_reserved), 0) AS units_reserved,
       SUM(sr.status = 'fulfilled') AS fulfilled_lines
FROM VICTIM_SOS v
LEFT JOIN SUPPLY_RESERVATION sr ON sr.sos_id = v.sos_id
GROUP BY v.sos_id, v.urgency_level
HAVING COUNT(sr.reservation_id) > 0
ORDER BY units_reserved DESC;

-- Q14 CASE: stock health label
SELECT sh.name AS shelter, r.item_name, st.quantity_available, st.reorder_threshold,
       CASE WHEN st.quantity_available = 0 THEN 'OUT OF STOCK'
            WHEN st.quantity_available <= st.reorder_threshold THEN 'LOW'
            WHEN st.quantity_available <= st.reorder_threshold*2 THEN 'WATCH'
            ELSE 'OK' END AS health
FROM STOCK st
JOIN SHELTER sh ON sh.shelter_id = st.shelter_id
JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
ORDER BY st.quantity_available / NULLIF(st.reorder_threshold, 0)
LIMIT 10;

-- Q15 UNION ALL: single "attention needed" feed
SELECT 'LOW STOCK' AS alert_type, CONCAT(shelter, ' - ', item_name) AS detail FROM v_low_stock
UNION ALL
SELECT 'SHELTER FULL', name FROM SHELTER WHERE status = 'full'
UNION ALL
SELECT 'VEHICLE IN MAINTENANCE', registration_no FROM LOGISTICS_VEHICLE WHERE status = 'maintenance';

-- Q16 LEFT JOIN + aggregates: vehicle utilisation
SELECT lv.registration_no, lv.type, lv.status,
       COUNT(d.log_id) AS trips,
       COALESCE(SUM(d.quantity_dispatched), 0) AS units_moved
FROM LOGISTICS_VEHICLE lv
LEFT JOIN DISTRIBUTION_LOG d ON d.vehicle_id = lv.vehicle_id
GROUP BY lv.vehicle_id, lv.registration_no, lv.type, lv.status
ORDER BY trips DESC, lv.registration_no;

-- Q17 Date functions + AVG: how long open SOS have been waiting
SELECT urgency_level, COUNT(*) AS open_sos,
       ROUND(AVG(TIMESTAMPDIFF(HOUR, reported_at, NOW())), 1) AS avg_hours_waiting,
       MAX(TIMESTAMPDIFF(HOUR, reported_at, NOW())) AS max_hours_waiting
FROM VICTIM_SOS
WHERE status <> 'resolved'
GROUP BY urgency_level
ORDER BY fn_urgency_rank(urgency_level) DESC;

-- Q18 Using the views
SELECT * FROM v_shelter_status ORDER BY occupancy_pct DESC;
SELECT * FROM v_low_stock ORDER BY shortfall DESC;
SELECT * FROM v_open_sos_priority ORDER BY priority_rank DESC, hours_waiting DESC;
SELECT * FROM v_dispatch_overview ORDER BY dispatch_time DESC;
SELECT * FROM v_item_stock_summary ORDER BY total_available DESC;
SELECT * FROM STOCK_ALERT ORDER BY alert_time;

-- 9. FULL-TEXT SEARCH

-- Natural-language mode, ranked by relevance
SELECT sos_id, urgency_level, description,
       MATCH(description) AGAINST('flood medicines') AS relevance
FROM VICTIM_SOS
WHERE MATCH(description) AGAINST('flood medicines' IN NATURAL LANGUAGE MODE)
ORDER BY relevance DESC;

-- Boolean mode: must contain flood*, must contain medic*, must NOT contain infant
SELECT sos_id, urgency_level, description
FROM VICTIM_SOS
WHERE MATCH(description) AGAINST('+flood* +medic* -infant' IN BOOLEAN MODE);

-- Search the item catalogue
SELECT item_id, item_name, category
FROM RESOURCE_ITEM
WHERE MATCH(item_name, category) AGAINST('medical shelter' IN NATURAL LANGUAGE MODE);

-- 10. UPDATE

-- U1  Escalate unmatched SOS waiting 12+ hours by one urgency level
UPDATE VICTIM_SOS
SET urgency_level = CASE urgency_level
                        WHEN 'low' THEN 'medium'
                        WHEN 'medium' THEN 'high'
                        WHEN 'high' THEN 'critical'
                        ELSE urgency_level END
WHERE status = 'unmatched'
  AND TIMESTAMPDIFF(HOUR, reported_at, NOW()) >= 12;

-- U2  Vehicle back from maintenance
UPDATE LOGISTICS_VEHICLE SET status = 'available' WHERE registration_no = 'KA-02-GH-3456';

-- U3  Reassign a volunteer to another shelter
UPDATE APP_USER SET shelter_id = 4 WHERE email = 'divya.reddy@relief.org';

-- U4  Multi-table UPDATE: raise reorder threshold of all Medical items by 5
UPDATE STOCK st
JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
SET st.reorder_threshold = st.reorder_threshold + 5
WHERE r.category = 'Medical';

-- U5  Update with subquery: bring Jayanagar water stock up to the all-shelter average
UPDATE STOCK
SET quantity_available = (SELECT avg_q FROM
        (SELECT ROUND(AVG(quantity_available)) AS avg_q FROM STOCK WHERE item_id = 1) t)
WHERE item_id = 1 AND shelter_id = 5;

-- 11. SMART MATCHING (procedures + cursor + triggers)

-- A volunteer files a new SOS through the procedure
CALL sp_register_sos(5, 'high',
     'Collapsed wall near market; family of four needs shelter and first aid',
     4, '13.0950,77.5950', NULL, @new_sos);
SELECT @new_sos AS new_sos_id;

-- Match one SOS
CALL sp_match_sos(@new_sos);

-- Match everything still unmatched, most urgent first
CALL sp_auto_match_unmatched(@matched, @failed);
SELECT @matched AS matched_count, @failed AS failed_count;

-- Where did everyone go? (Whitefield was full, so SOS 8 should go to the next nearest)
SELECT v.sos_id, v.urgency_level, v.people_count, v.status, s.name AS shelter,
       ROUND(fn_distance_km(v.lat_long, s.lat_long), 2) AS dist_km
FROM VICTIM_SOS v
LEFT JOIN SHELTER s ON s.shelter_id = v.matched_shelter_id
ORDER BY v.sos_id;

SELECT * FROM v_shelter_status;   -- occupancy/status updated by triggers

-- Resolve SOS 2 -> people leave shelter 1, un-dispatched reservations are released
UPDATE VICTIM_SOS SET status = 'resolved' WHERE sos_id = 2;
SELECT * FROM v_shelter_status WHERE shelter_id = 1;

-- 12. DELETE

-- D1  Remove a duplicate/spam SOS (allowed: it has no active reservations)
CALL sp_register_sos(3, 'low', 'duplicate test report - please ignore', 1, NULL, NULL, @dup);
DELETE FROM VICTIM_SOS WHERE sos_id = @dup;

-- D2  Cancel a dispatch, then purge cancelled dispatch logs
UPDATE DISTRIBUTION_LOG SET status = 'cancelled' WHERE log_id = @l3;   -- vehicle freed, reservation -> pending
DELETE FROM DISTRIBUTION_LOG WHERE status = 'cancelled';

-- D3  Purge resolved low-stock alerts older than 30 days
DELETE FROM STOCK_ALERT
WHERE is_resolved = TRUE AND alert_time < NOW() - INTERVAL 30 DAY;

-- D4  Delete a stock row that no reservation depends on
DELETE FROM STOCK WHERE item_id = 3 AND shelter_id = 5;

-- 13. EXPLICIT TRANSACTIONS  (COMMIT / ROLLBACK / SAVEPOINT)

-- T1  Atomic transfer through the procedure
CALL sp_transfer_stock(1, 4, 5, 100);          -- 100 L water: Yelahanka -> Jayanagar

-- T2  Manual transaction with SAVEPOINT
START TRANSACTION;
    UPDATE STOCK SET quantity_available = quantity_available - 10
     WHERE item_id = 2 AND shelter_id = 1;       -- rice leaves shelter 1
    SAVEPOINT after_first_move;
    UPDATE STOCK SET quantity_available = quantity_available - 50
     WHERE item_id = 2 AND shelter_id = 4;       -- mistake: wrong shelter
    ROLLBACK TO SAVEPOINT after_first_move;      -- undo only the mistake
    UPDATE STOCK SET quantity_available = quantity_available + 10
     WHERE item_id = 2 AND shelter_id = 2;       -- rice arrives at shelter 2
COMMIT;

-- T3  Full rollback demo
START TRANSACTION;
    UPDATE SHELTER SET capacity = capacity + 1000;
    SELECT shelter_id, capacity FROM SHELTER;    -- visible inside the transaction
ROLLBACK;
SELECT shelter_id, capacity FROM SHELTER;        -- original values are back

-- 14. VALIDATION TESTS  -- run ONE AT A TIME; each is meant to FAIL
--     (take screenshots of the error messages for the report)

/*
-- V1 CHECK: negative capacity
INSERT INTO SHELTER (name, capacity) VALUES ('Bad Shelter', -5);

-- V2 CHECK: occupancy > capacity
UPDATE SHELTER SET current_occupancy = capacity + 1 WHERE shelter_id = 1;

-- V3 CHECK: invalid email / phone
INSERT INTO APP_USER (name, role, email, phone, password_hash)
VALUES ('X', 'Field Volunteer', 'not-an-email', '12345', 'hash');

-- V4 CHECK: invalid role
INSERT INTO APP_USER (name, role, email, password_hash)
VALUES ('X', 'Admin', 'x@relief.org', 'hash');

-- V5 TRIGGER: over-reserving stock
CALL sp_reserve_supply(4, 4, 4, 9999, @x);

-- V6 TRIGGER: only a coordinator can approve a dispatch (user 3 is a volunteer)
CALL sp_approve_dispatch(@r5, 2, 3, 10, @x);

-- V7 TRIGGER: dispatch more than reserved
CALL sp_approve_dispatch(@r5, 1, 1, 9999, @x);

-- V8 TRIGGER: close a shelter that still has people in it
UPDATE SHELTER SET status = 'closed' WHERE shelter_id = 1;

-- V9 TRIGGER: re-open a resolved SOS
UPDATE VICTIM_SOS SET status = 'unmatched' WHERE sos_id = 2;

-- V10 TRIGGER: delete an SOS that still has active reservations
DELETE FROM VICTIM_SOS WHERE sos_id = 3;

-- V11 FK (RESTRICT): delete a user who reported SOS
DELETE FROM APP_USER WHERE user_id = 3;

-- V12 Transaction rollback: transfer more stock than exists
CALL sp_transfer_stock(1, 5, 1, 999999);
*/

-- 15. INDEXING + EXPLAIN

SHOW INDEX FROM VICTIM_SOS;

-- Uses idx_sos_triage (status, urgency_level, reported_at) - no filesort
EXPLAIN SELECT sos_id, reported_at
        FROM VICTIM_SOS
        WHERE status = 'matched' AND urgency_level = 'critical'
        ORDER BY reported_at;

-- Compare with a forced full table scan
EXPLAIN SELECT sos_id, reported_at
        FROM VICTIM_SOS IGNORE INDEX (idx_sos_triage, idx_sos_status)
        WHERE status = 'matched' AND urgency_level = 'critical'
        ORDER BY reported_at;

-- Unique composite index (item_id, shelter_id) serves the stock lookups
EXPLAIN SELECT quantity_available FROM STOCK WHERE item_id = 1 AND shelter_id = 2;

-- Full-text index in use
EXPLAIN SELECT sos_id FROM VICTIM_SOS
        WHERE MATCH(description) AGAINST('flood' IN NATURAL LANGUAGE MODE);

-- 16. ROLES / PRIVILEGES  (database-level role-based access control)
--     Mirrors the two app roles: Relief Coordinator & Field Volunteer

CREATE ROLE IF NOT EXISTS 'relief_coordinator', 'field_volunteer';

GRANT SELECT, INSERT, UPDATE ON disaster_relief.* TO 'relief_coordinator';
GRANT DELETE ON disaster_relief.STOCK_ALERT TO 'relief_coordinator';
GRANT EXECUTE ON disaster_relief.* TO 'relief_coordinator';

GRANT SELECT ON disaster_relief.v_shelter_status TO 'field_volunteer';
GRANT SELECT ON disaster_relief.v_low_stock TO 'field_volunteer';
GRANT SELECT ON disaster_relief.v_open_sos_priority TO 'field_volunteer';
GRANT SELECT, INSERT ON disaster_relief.VICTIM_SOS TO 'field_volunteer';
GRANT EXECUTE ON PROCEDURE disaster_relief.sp_register_sos TO 'field_volunteer';

SHOW GRANTS FOR 'field_volunteer';
-- To use: CREATE USER 'vol_app'@'localhost' IDENTIFIED BY '<strong-password>';
--         GRANT 'field_volunteer' TO 'vol_app'@'localhost';

-- 17. DDL DEMO: ALTER / DROP

ALTER TABLE LOGISTICS_VEHICLE ADD COLUMN driver_name VARCHAR(80) NOT NULL DEFAULT 'Unassigned';
ALTER TABLE LOGISTICS_VEHICLE MODIFY COLUMN driver_name VARCHAR(120) NOT NULL DEFAULT 'TBD';
ALTER TABLE LOGISTICS_VEHICLE DROP COLUMN driver_name;

CREATE TABLE tmp_scratch (id INT PRIMARY KEY, note VARCHAR(50));
ALTER TABLE tmp_scratch RENAME TO tmp_scratch_old;
DROP TABLE tmp_scratch_old;

DROP INDEX idx_shelter_status ON SHELTER;                 -- optional clean-up demo
CREATE INDEX idx_shelter_status ON SHELTER(status);       -- re-create it

SET SQL_SAFE_UPDATES = 1;

