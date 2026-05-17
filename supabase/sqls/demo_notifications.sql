


INSERT INTO public.flow_notifications (
  user_id, 
  title, 
  description, 
  type, 
  icon, 
  icon_color, 
  bg_color, 
  read, 
  extra
) 
SELECT 
  id as user_id,
  'Standard Notification' as title,
  'This is a basic notification without any special interaction blocks.' as description,
  'General' as type,
  'Bell' as icon,
  'text-blue-500' as icon_color,
  'bg-blue-500/10' as bg_color,
  false as read,
  '{}'::jsonb as extra
FROM auth.users 
LIMIT 1;

INSERT INTO public.flow_notifications (
  user_id, 
  title, 
  description, 
  type, 
  icon, 
  icon_color, 
  bg_color, 
  read, 
  extra
) 
SELECT 
  id as user_id,
  'Zaid commented on a project' as title,
  'Zaid left a feedback on the new dashboard design.' as description,
  'Mentions' as type,
  'MessageSquare' as icon,
  'text-orange-500' as icon_color,
  'bg-orange-500/10' as bg_color,
  false as read,
  '{"type": "comment", "text": "I think we should use a more vibrant blue for the call-to-action buttons. The current one feels a bit too muted for our brand."}'::jsonb as extra
FROM auth.users 
LIMIT 1;

INSERT INTO public.flow_notifications (
  user_id, 
  title, 
  description, 
  type, 
  icon, 
  icon_color, 
  bg_color, 
  read, 
  extra
) 
SELECT 
  id as user_id,
  'Caitlyn shared 2 files' as title,
  'Caitlyn uploaded new assets for the QuartzAI project.' as description,
  'Files' as type,
  'FileUp' as icon,
  'text-purple-500' as icon_color,
  'bg-purple-500/10' as bg_color,
  false as read,
  '{
    "type": "file", 
    "files": [
      {"name": "QuartzAI_Branding_Guide.pdf", "size": "4.2 MB", "iconType": "file"},
      {"name": "Logo_Main_Hero.png", "size": "1.8 MB", "iconType": "image"}
    ]
  }'::jsonb as extra
FROM auth.users 
LIMIT 1;

INSERT INTO public.flow_notifications (
  user_id, 
  title, 
  description, 
  type, 
  icon, 
  icon_color, 
  bg_color, 
  read, 
  extra
) 
SELECT 
  id as user_id,
  'Access Request' as title,
  'Marco is requesting access to the Leapyear project.' as description,
  'Inbox' as type,
  'UserPlus' as icon,
  'text-green-500' as icon_color,
  'bg-green-500/10' as bg_color,
  false as read,
  '{"type": "actions", "options": ["Deny Access", "Grant Access"]}'::jsonb as extra
FROM auth.users 
LIMIT 1;
