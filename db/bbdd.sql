-- BD
CREATE DATABASE IF NOT EXISTS iot
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE iot;

-- device
CREATE TABLE IF NOT EXISTS device (
  device_id  VARCHAR(64) NOT NULL,
  api_token  CHAR(48)    NOT NULL,
  PRIMARY KEY (device_id),
  UNIQUE KEY uk_device_token (api_token)
) ENGINE=InnoDB;

-- session
CREATE TABLE IF NOT EXISTS session (
  session_id   INT NOT NULL AUTO_INCREMENT,
  device_id    VARCHAR(64) NOT NULL,
  started_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  active_until DATETIME(3) NOT NULL,
  PRIMARY KEY (session_id),
  KEY ix_session_active (device_id, active_until),
  CONSTRAINT fk_session_device FOREIGN KEY (device_id)
    REFERENCES device(device_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- measurement
CREATE TABLE IF NOT EXISTS measurement (
  id                 BIGINT      NOT NULL AUTO_INCREMENT,
  session_id         INT         NOT NULL,
  seq                SMALLINT    NOT NULL,             -- 0..59

  device_recorded_at DATETIME(3) NOT NULL,             -- hora real de la medición (UTC)
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  ntu                DOUBLE      NOT NULL,
  raw_mv             INT         NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_session_seq (session_id, seq),
  KEY ix_meas_session (session_id),
  KEY ix_meas_session_order (session_id, device_recorded_at, seq),

  CONSTRAINT fk_meas_session FOREIGN KEY (session_id)
    REFERENCES session(session_id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- Semilla del device
INSERT INTO device(device_id, api_token)
VALUES ('esp32-A','Generar 48 caracteres hexadecimales aleatorios')
ON DUPLICATE KEY UPDATE api_token=VALUES(api_token);