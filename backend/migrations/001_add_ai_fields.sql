-- Add AI fields to leads
ALTER TABLE `leads`
  ADD COLUMN `ai_score` INT UNSIGNED NULL,
  ADD COLUMN `qualification_status` VARCHAR(50) NULL,
  ADD COLUMN `qualification_notes` TEXT NULL,
  ADD COLUMN `sentiment` ENUM('positive','neutral','negative') NULL;

-- Add AI summary and suggested agent to conversations
ALTER TABLE `conversations`
  ADD COLUMN `summary` TEXT NULL,
  ADD COLUMN `suggested_agent` VARCHAR(255) NULL;

-- Add sentiment fields to messages
ALTER TABLE `messages`
  ADD COLUMN `sentiment` ENUM('positive','neutral','negative') NULL,
  ADD COLUMN `sentiment_score` DECIMAL(5,4) NULL;
