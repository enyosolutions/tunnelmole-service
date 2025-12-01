CREATE TABLE IF NOT EXISTS `client_telemetry` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `date` DATETIME DEFAULT NULL,
  `type` VARCHAR(255) DEFAULT NULL,
  `data` TEXT DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `reserved_domains` (
  `id` int NOT NULL AUTO_INCREMENT,
  `apiKey` VARCHAR(255) NOT NULL,
  `subdomain` VARCHAR(255) NOT NULL,
  `lastUseDate` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `client_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clientId` varchar(255) DEFAULT NULL,
  `eventKey` varchar(255) DEFAULT NULL,
  `eventValue` text,
  `date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `request_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hostname` varchar(255) NOT NULL,
  `path` text,
  `method` varchar(25) DEFAULT NULL,
  `request_headers` longtext,
  `request_body` longtext,
  `response_status` int DEFAULT NULL,
  `response_headers` longtext,
  `response_body` longtext,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `hostname_created_at` (`hostname`, `created_at`)
);

CREATE TABLE IF NOT EXISTS `request_log_credentials` (
  `hostname` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`hostname`)
);
