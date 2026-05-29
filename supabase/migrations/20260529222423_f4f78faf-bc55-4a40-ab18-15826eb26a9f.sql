-- Add 'customer' role to app_role enum and update handle_new_user trigger
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';
