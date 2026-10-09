/** Test-environment helper: publish the required booking terms so checkout works. */
import { run } from "../../src/db/index";

run(`UPDATE policies SET status = 'published', requires_acceptance = 1 WHERE slug = 'booking-terms'`);
run(`INSERT INTO settings (key, value) VALUES ('multi_date_discount_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'`);
run(`INSERT INTO settings (key, value) VALUES ('class_passes_enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'`);
console.log("booking-terms published for test environment");
