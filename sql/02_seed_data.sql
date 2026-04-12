-- Seed default configurations
INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES
(1, 'detection_categories', '["fadiga", "distracao"]', 'Categorias de deteccao ativas. Cada uma recebe score 1-10.', NOW()),
(2, 'scan_prompt', 'Analyze this truck cabin camera image. Look for fatigue (drooping eyelids, yawning, head nodding, eyes closing) and distraction (phone use, looking away, eating). Rate each 1-10. Be conservative.', 'Prompt de analise por frame', NOW()),
(3, 'detail_prompt', 'Analyze in detail. Score 1-10 for fadiga and distracao, description IN PORTUGUESE, confidence.', 'Prompt detalhado', NOW()),
(4, 'scan_fps', '0.2', 'Frames por segundo de amostragem (0.2 = 1 frame a cada 5s)', NOW()),
(5, 'detail_fps', '1.0', 'FPS para analise detalhada', NOW()),
(6, 'score_threshold', '4', 'Score minimo para registrar como deteccao', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- Seed default branding (neutral/generic)
INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES
(1, 'primary_color', '#2563EB', NOW()),
(2, 'secondary_color', '#1E293B', NOW()),
(3, 'accent_color', '#3B82F6', NOW()),
(4, 'sidebar_color', '#0F172A', NOW())
ON CONFLICT (setting_key) DO NOTHING;
