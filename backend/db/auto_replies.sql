CREATE TABLE IF NOT EXISTS `auto_replies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trigger` VARCHAR(255) NOT NULL,
  `match_type` ENUM('exact','contains','regex') NOT NULL DEFAULT 'contains',
  `response` TEXT NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auto_replies_trigger` (`trigger`),
  KEY `idx_auto_replies_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
