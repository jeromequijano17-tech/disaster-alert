CREATE DATABASE IF NOT EXISTS disaster_alert
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE disaster_alert;

CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  password   VARCHAR(255) NOT NULL,                 -- bcrypt hash, never plain text
  role       ENUM('admin','resident') NOT NULL DEFAULT 'resident',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alerts (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  type       ENUM('typhoon','flood','earthquake','landslide','fire','other') NOT NULL,
  level      ENUM('advisory','warning','emergency') NOT NULL,
  title      VARCHAR(150) NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_alerts_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS responses (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  alert_id   INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  status     ENUM('safe','need_help') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_response_alert_user (alert_id, user_id),   -- one response per resident per alert (can be changed)
  CONSTRAINT fk_responses_alert FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
  CONSTRAINT fk_responses_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- Extra table (needed for Web Push): one row per resident device that allowed notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  endpoint      TEXT NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh        VARCHAR(255) NOT NULL,
  auth          VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
