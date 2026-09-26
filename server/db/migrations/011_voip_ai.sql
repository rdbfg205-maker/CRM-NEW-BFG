-- 011_voip_ai.sql — AI & Calls (item 39): transcript column for STT results (additive, VoIP-scoped)
-- When a recording is transcribed (STT), the transcript is stored here and the
-- AI analysis of the call is based on the real transcript. Otherwise the analysis
-- is explicitly based on metadata + notes (basis field in the API response).
ALTER TABLE voip_calls ADD COLUMN transcript TEXT;
