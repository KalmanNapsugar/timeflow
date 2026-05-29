
-- Admin read-only policies for cross-organization support / impersonation
CREATE POLICY "bookings_admin_read" ON public.bookings FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "customers_admin_read" ON public.customers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "audit_logs_admin_read" ON public.audit_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "notif_logs_admin_read" ON public.notification_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "notif_tmpl_admin_read" ON public.notification_templates FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "inv_items_admin_read" ON public.inventory_items FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "inv_mov_admin_read" ON public.inventory_movements FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "coupons_admin_read" ON public.coupons FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "vouchers_admin_read" ON public.vouchers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "org_members_admin_read" ON public.organization_members FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "staff_inv_admin_read" ON public.staff_invitations FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));
