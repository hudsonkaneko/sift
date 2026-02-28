-- Add recurring column to fixed_blocks (default false = not recurring)
ALTER TABLE fixed_blocks
  ADD COLUMN recurring BOOLEAN NOT NULL DEFAULT false;
