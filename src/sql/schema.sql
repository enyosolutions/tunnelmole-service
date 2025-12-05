-- Function: generate_load_test_data
-- Description: Generates a large amount of auth.users and business_customers_v2 records for load testing
-- Parameters:
--   p_chain_id: The chain_id to associate the business customers with
--   p_number_of_rows: The number of users and business customers to create
-- Returns: The number of records created
--
-- Optimized for bulk operations using generate_series and CTEs

CREATE OR REPLACE FUNCTION public.generate_load_test_data(
  p_chain_id int4,
  p_number_of_rows int4
)
RETURNS int4
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_business_id int8;
  v_base_timestamp bigint;
  v_batch_size int4 := 1000; -- Process in batches to avoid memory issues
  v_processed int4 := 0;
  v_remaining int4;
BEGIN
  -- Get a business_id from the chain (optional, can be null)
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE chain_id = p_chain_id
  LIMIT 1;

  -- Generate a base timestamp to ensure uniqueness across multiple calls
  v_base_timestamp := extract(epoch from now())::bigint * 1000000 + (random() * 1000000)::bigint;
  v_remaining := p_number_of_rows;

  -- Process in batches to avoid memory issues and improve performance
  WHILE v_remaining > 0 LOOP
    DECLARE
      v_current_batch int4 := LEAST(v_batch_size, v_remaining);
      v_start_offset int4 := v_processed;
    BEGIN
      -- Bulk insert users using CTE with generate_series
      WITH user_data AS (
        SELECT
          gen_random_uuid() as id,
          v_base_timestamp + (v_start_offset + s.i) * 1000 + (random() * 999)::bigint as ts,
          v_start_offset + s.i as row_num
        FROM generate_series(1, v_current_batch) s(i)
      ),
      users_inserted AS (
        INSERT INTO auth.users (
          id,
          instance_id,
          role,
          aud,
          email,
          phone,
          raw_app_meta_data,
          raw_user_meta_data,
          is_super_admin,
          encrypted_password,
          created_at,
          updated_at,
          last_sign_in_at,
          email_confirmed_at,
          confirmation_sent_at,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change
        )
        SELECT
          ud.id,
          '00000000-0000-0000-0000-000000000000',
          'authenticated',
          'authenticated',
          'loadtest_' || ud.ts || '@test.yalt.me',
          '+351' || (900000000 + ((ud.ts + ud.row_num * 1000) % 100000000))::text,
          '{"provider":"email","providers":["email"]}',
          json_build_object(
            'source', 'load_test',
            'first_name', 'LoadTest' || ud.row_num,
            'last_name', 'User' || ud.row_num,
            'is_test', true
          ),
          FALSE,
          extensions.crypt('12345678', gen_salt('bf')),
          NOW(),
          NOW(),
          NOW(),
          NOW(),
          NOW(),
          '',
          '',
          '',
          ''
        FROM user_data ud
        RETURNING id, phone, email
      ),
      users_with_numbers AS (
        SELECT
          ui.id,
          ui.phone,
          ui.email,
          ud.row_num
        FROM users_inserted ui
        JOIN user_data ud ON ud.id = ui.id
      ),
      identities_inserted AS (
        INSERT INTO auth.identities (
          id,
          provider_id,
          provider,
          user_id,
          identity_data,
          last_sign_in_at,
          created_at,
          updated_at
        )
        SELECT
          uwn.id,
          uwn.id,
          'email',
          uwn.id,
          json_build_object('sub', uwn.id::text),
          NOW(),
          NOW(),
          NOW()
        FROM users_with_numbers uwn
      )
      INSERT INTO public.business_customers_v2 (
        user_id,
        chain_id,
        added_from_business_id,
        first_name,
        last_name,
        email,
        phonenumber,
        source,
        created_at,
        last_modified_at
      )
      SELECT
        uwn.id,
        p_chain_id,
        v_business_id,
        'LoadTest' || uwn.row_num,
        'User' || uwn.row_num,
        uwn.email,
        uwn.phone,
        'load_test',
        NOW(),
        NOW()
      FROM users_with_numbers uwn;

      v_processed := v_processed + v_current_batch;
      v_remaining := v_remaining - v_current_batch;
    END;
  END LOOP;

  RETURN v_processed;
END;
$$;

-- Add comment to function
COMMENT ON FUNCTION public.generate_load_test_data(int4, int4) IS 'Generates test users and business customers for load testing using bulk inserts. Takes chain_id and number_of_rows as parameters. Processes in batches of 1000 for optimal performance.';



select generate_load_test_data(36, 500);
select generate_load_test_data(36, 1000);
select generate_load_test_data(36, 10000);

