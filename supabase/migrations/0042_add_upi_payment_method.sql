-- 0042_add_upi_payment_method.sql
--
-- Add 'upi' as a supported value in payment_method_enum.
--
-- Postgres supports `alter type payment_method_enum add value 'upi';`
-- Because UPI flows directly through the group's bank account,
-- it does not enter the cashier's physical cash float (cash_ledger).

alter type payment_method_enum add value if not exists 'upi';
