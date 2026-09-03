-- =============================================
--  SISTEMA DE VEEDORES ELECTORALES - Sucúa 2026
--  Ejecutar este script una sola vez para crear la BD
-- =============================================

CREATE DATABASE IF NOT EXISTS veedores_sucua_bd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE veedores_sucua_bd;

-- USUARIOS (admin y veedores)
CREATE TABLE IF NOT EXISTS usuarios (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    cedula           VARCHAR(20),
    usuario          VARCHAR(50) UNIQUE NOT NULL,
    password         VARCHAR(255) NOT NULL,
    rol              ENUM('superadmin','admin','veedor') NOT NULL DEFAULT 'veedor',
    fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- JUNTAS ELECTORALES
CREATE TABLE IF NOT EXISTS juntas (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    parroquia       VARCHAR(100) NOT NULL,
    zona            VARCHAR(100) NOT NULL,
    numero_junta    VARCHAR(50)  NOT NULL,
    UNIQUE KEY uq_junta (parroquia, zona, numero_junta)
);

-- CONFIGURACIÓN DE DIGNIDADES
CREATE TABLE IF NOT EXISTS dignidad_config (
    clave VARCHAR(64) PRIMARY KEY,
    habilitada TINYINT(1) NOT NULL DEFAULT 1
);

INSERT IGNORE INTO dignidad_config (clave, habilitada) VALUES
('ALCALDE', 1),
('CONCEJALES_URBANOS', 1),
('CONCEJALES_RURALES', 1),
('JUNTAS_PARROQUIALES', 1);

-- CANDIDATOS POR DIGNIDAD
CREATE TABLE IF NOT EXISTS candidatos (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    dignidad  VARCHAR(40) NOT NULL DEFAULT 'ALCALDE',
    nombre    VARCHAR(150) NOT NULL,
    partido   VARCHAR(100),
    orden     INT DEFAULT 0,
    INDEX idx_dignidad (dignidad)
);

-- RESULTADOS POR JUNTA Y DIGNIDAD
CREATE TABLE IF NOT EXISTS resultados (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    junta_id         INT NOT NULL,
    dignidad         VARCHAR(40) NOT NULL DEFAULT 'ALCALDE',
    candidato        VARCHAR(150) NOT NULL,
    votos            INT NOT NULL DEFAULT 0,
    id_veedor        INT,
    fecha_registro   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_resultado (junta_id, dignidad, candidato),
    FOREIGN KEY (junta_id)  REFERENCES juntas(id),
    FOREIGN KEY (id_veedor) REFERENCES usuarios(id)
);

-- FOTOS DE ACTAS (una foto por junta)
CREATE TABLE IF NOT EXISTS fotos_actas (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    junta_id      INT NOT NULL UNIQUE,
    foto          VARCHAR(255) NOT NULL,
    id_veedor     INT,
    fecha_subida  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (junta_id)  REFERENCES juntas(id),
    FOREIGN KEY (id_veedor) REFERENCES usuarios(id)
);

-- =============================================
--  DATOS INICIALES
-- =============================================

-- Admin por defecto (usuario: admin / clave: admin123)
INSERT IGNORE INTO usuarios (cedula, usuario, password, rol)
VALUES ('0000000000', 'admin', 'admin123', 'admin');

-- Parroquias, zonas y juntas — MODIFICA SEGÚN TU CANTÓN
INSERT IGNORE INTO juntas (parroquia, zona, numero_junta) VALUES
('Sucúa',           'Centro',    'Junta 1'),
('Sucúa',           'Centro',    'Junta 2'),
('Sucúa',           'Centro',    'Junta 3'),
('Sucúa',           'Norte',     'Junta 1'),
('Sucúa',           'Norte',     'Junta 2'),
('Sucúa',           'Sur',       'Junta 1'),
('Sucúa',           'Sur',       'Junta 2'),
('Huambi',          'Centro',    'Junta 1'),
('Huambi',          'Centro',    'Junta 2'),
('Asunción',        'Centro',    'Junta 1'),
('Asunción',        'Centro',    'Junta 2'),
('Santa Marianita', 'Centro',    'Junta 1');

-- Candidatos por dignidad — MODIFICA CON LOS REALES
INSERT IGNORE INTO candidatos (dignidad, nombre, partido, orden) VALUES
('ALCALDE',             'Candidato Alcalde A', 'Partido 1', 1),
('ALCALDE',             'Candidato Alcalde B', 'Partido 2', 2),
('CONCEJALES_URBANOS',  'Candidato Conc Urb A', 'Partido 1', 1),
('CONCEJALES_URBANOS',  'Candidato Conc Urb B', 'Partido 2', 2),
('CONCEJALES_RURALES',  'Candidato Conc Rur A', 'Partido 1', 1),
('CONCEJALES_RURALES',  'Candidato Conc Rur B', 'Partido 2', 2),
('JUNTAS_PARROQUIALES', 'Candidato Junt Par A', 'Partido 1', 1),
('JUNTAS_PARROQUIALES', 'Candidato Junt Par B', 'Partido 2', 2);

UPDATE veedores_sucua_bd.usuarios SET rol = 'superadmin' WHERE usuario = 'irvin';