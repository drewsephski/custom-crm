ALTER TABLE "appSetting"
  ADD CONSTRAINT "appSetting_trackingSiteId_shape"
  CHECK ("trackingSiteId" IS NULL OR "trackingSiteId" ~ '^cmp_([0-9a-f]{8}|[0-9a-f]{32})$');
