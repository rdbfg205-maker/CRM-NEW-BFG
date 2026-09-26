-- 009: repair dropped permission scopes.
-- role_permissions has PRIMARY KEY (role_id, permission_id); the seed issued two grants for
-- the same (role, entity, action) with different scopes (own, then team/all). The second
-- INSERT OR IGNORE was silently ignored, leaving the narrower scope and breaking
-- customer visibility (support saw 0 customers; sales could not see team customers).
UPDATE role_permissions SET scope='team'
 WHERE role_id = (SELECT id FROM roles WHERE name='sales')
   AND permission_id IN (SELECT id FROM permissions WHERE entity IN ('customer','lead','opportunity','quote','order','product') AND action='view');
UPDATE role_permissions SET scope='all'
 WHERE role_id = (SELECT id FROM roles WHERE name='support')
   AND permission_id IN (SELECT id FROM permissions WHERE entity IN ('customer','complaint','ticket') AND action='view');
UPDATE role_permissions SET scope='all'
 WHERE role_id = (SELECT id FROM roles WHERE name='marketing')
   AND permission_id IN (SELECT id FROM permissions WHERE entity='customer' AND action='view');
UPDATE role_permissions SET scope='all'
 WHERE role_id = (SELECT id FROM roles WHERE name='lab')
   AND permission_id IN (SELECT id FROM permissions WHERE entity IN ('customer','lab_request') AND action='view');
