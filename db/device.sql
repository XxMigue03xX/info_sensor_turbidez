-- Semilla del device
INSERT INTO device(device_id, api_token)
VALUES ('esp32-A','Generar 48 caracteres hexadecimales aleatorios')
ON DUPLICATE KEY UPDATE api_token=VALUES(api_token);