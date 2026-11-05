-- =========================================================
-- Disaster Response & Smart Relief Logistics Engine
-- MySQL 8.0+ DDL
-- (CHECK constraints require MySQL 8.0.16 or later;
--  on older versions they are parsed but silently ignored)
--
-- Creation order respects FK dependencies:
-- SHELTER, RESOURCE_ITEM, LOGISTICS_VEHICLE
--   -> APP_USER
--   -> VICTIM_SOS
--   -> STOCK, SUPPLY_RESERVATION
--   -> DISTRIBUTION_LOG
-- =========================================================
CREATE DATABASE disaster_relief;
USE disaster_relief;

SET default_storage_engine = InnoDB;

-- ---------- Tables with no FK dependencies ----------

CREATE TABLE SHELTER (
    shelter_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    address VARCHAR(255),
    capacity INT NOT NULL CHECK (capacity >= 0),
    current_occupancy INT NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
           CHECK (status IN ('active','full','closed')),
    lat_long VARCHAR(60),
    CHECK (current_occupancy <= capacity)
);

CREATE TABLE RESOURCE_ITEM (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    item_name VARCHAR(120) NOT NULL,
    category VARCHAR(50) NOT NULL,
    unit VARCHAR(20) NOT NULL
);

CREATE TABLE LOGISTICS_VEHICLE (
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    registration_no VARCHAR(30) NOT NULL UNIQUE,
    type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
           CHECK (status IN ('available','in_transit','maintenance')),
    capacity_kg DECIMAL(10,2) CHECK (capacity_kg > 0)
);

-- ---------- APP_USER depends on SHELTER ----------
-- (named APP_USER, not USER, because USER is a reserved word in MySQL too)

CREATE TABLE APP_USER (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    role VARCHAR(30) NOT NULL
         CHECK (role IN ('Relief Coordinator','Field Volunteer')),
    email VARCHAR(120) NOT NULL UNIQUE,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    shelter_id INT,
    CONSTRAINT fk_user_shelter
        FOREIGN KEY (shelter_id) REFERENCES SHELTER(shelter_id)
        ON DELETE SET NULL
);

-- ---------- VICTIM_SOS depends on APP_USER, SHELTER ----------

CREATE TABLE VICTIM_SOS (
    sos_id INT AUTO_INCREMENT PRIMARY KEY,
    urgency_level VARCHAR(20) NOT NULL
                  CHECK (urgency_level IN ('low','medium','high','critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'unmatched'
           CHECK (status IN ('unmatched','matched','resolved')),
    reported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    intake_doc_ref VARCHAR(255),     
    reported_by INT NOT NULL,
    matched_shelter_id INT,
    CONSTRAINT fk_sos_reported_by
        FOREIGN KEY (reported_by) REFERENCES APP_USER(user_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_sos_matched_shelter
        FOREIGN KEY (matched_shelter_id) REFERENCES SHELTER(shelter_id)
        ON DELETE SET NULL
);

-- ---------- STOCK depends on RESOURCE_ITEM, SHELTER ----------

CREATE TABLE STOCK (
    stock_id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    shelter_id INT NOT NULL,
    quantity_available INT NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
    reorder_threshold INT NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
    last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_stock_item
        FOREIGN KEY (item_id) REFERENCES RESOURCE_ITEM(item_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_stock_shelter
        FOREIGN KEY (shelter_id) REFERENCES SHELTER(shelter_id)
        ON DELETE CASCADE,
    CONSTRAINT uq_stock_item_shelter UNIQUE (item_id, shelter_id)
);

-- ---------- SUPPLY_RESERVATION depends on RESOURCE_ITEM, SHELTER, VICTIM_SOS, STOCK ----------

CREATE TABLE SUPPLY_RESERVATION (
    reservation_id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    shelter_id INT NOT NULL,
    sos_id INT NOT NULL,
    quantity_reserved INT NOT NULL CHECK (quantity_reserved > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending','committed','cancelled','fulfilled')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reservation_item
        FOREIGN KEY (item_id) REFERENCES RESOURCE_ITEM(item_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_reservation_shelter
        FOREIGN KEY (shelter_id) REFERENCES SHELTER(shelter_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_reservation_sos
        FOREIGN KEY (sos_id) REFERENCES VICTIM_SOS(sos_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reservation_stock
        FOREIGN KEY (item_id, shelter_id) REFERENCES STOCK(item_id, shelter_id)
        ON DELETE RESTRICT
);

-- ---------- DISTRIBUTION_LOG depends on SUPPLY_RESERVATION, LOGISTICS_VEHICLE, APP_USER ----------

CREATE TABLE DISTRIBUTION_LOG (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT NOT NULL,
    vehicle_id INT,
    approved_by INT NOT NULL,
    quantity_dispatched INT NOT NULL CHECK (quantity_dispatched > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'dispatched'
           CHECK (status IN ('dispatched','delivered','cancelled')),
    dispatch_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_log_reservation
        FOREIGN KEY (reservation_id) REFERENCES SUPPLY_RESERVATION(reservation_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_log_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES LOGISTICS_VEHICLE(vehicle_id)
        ON DELETE SET NULL,
    CONSTRAINT fk_log_approved_by
        FOREIGN KEY (approved_by) REFERENCES APP_USER(user_id)
        ON DELETE RESTRICT
);

-- ---------- Indexes to support common lookups ----------

CREATE INDEX idx_stock_shelter ON STOCK(shelter_id);
CREATE INDEX idx_reservation_status ON SUPPLY_RESERVATION(status);
CREATE INDEX idx_sos_status ON VICTIM_SOS(status);
CREATE INDEX idx_distribution_dispatch_time ON DISTRIBUTION_LOG(dispatch_time);
