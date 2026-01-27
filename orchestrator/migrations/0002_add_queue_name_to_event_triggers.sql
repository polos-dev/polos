-- Add queue_name column to event_triggers table
-- Default to workflow_id for existing rows
ALTER TABLE event_triggers 
ADD COLUMN queue_name text;

-- Set queue_name to workflow_id for existing rows
UPDATE event_triggers 
SET queue_name = workflow_id 
WHERE queue_name IS NULL;
