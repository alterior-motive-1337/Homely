import type { HomelyDatabase } from "./db.js";

const NOW = "2026-10-01T12:00:00.000Z";
const HOME = "home-hawthorn";

export function hasHome(db: HomelyDatabase): boolean {
  return Boolean(db.prepare("SELECT 1 AS hit FROM homes LIMIT 1").get());
}

export function seedDemo(db: HomelyDatabase): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      DELETE FROM transaction_changes;
      DELETE FROM transactions;
      DELETE FROM timeline_events;
      DELETE FROM projects;
      DELETE FROM documents;
      DELETE FROM maintenance_rules;
      DELETE FROM issues;
      DELETE FROM assets;
      DELETE FROM systems;
      DELETE FROM homes;
    `);

    db.prepare("INSERT INTO homes(id,name,address_label,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run(HOME, "14 Hawthorn Residence", "North-west Johannesburg demo property", "2024-04-13T09:00:00.000Z", NOW);

    db.prepare(`
      INSERT INTO projects(
        id,home_id,title,status,description,start_date,target_date,budget_cents,completed_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      "project-battery-expansion",
      HOME,
      "Battery storage expansion",
      "PLANNED",
      "Evaluate and add additional battery capacity before the summer outage season.",
      "2026-10-15",
      "2026-12-15",
      2500000,
      null,
      "2026-09-30T10:00:00.000Z",
      NOW
    );

    const systems = [
      ["sys-electrical","Electrical","ELECTRICAL","Distribution and fixed electrical infrastructure",1],
      ["sys-solar","Solar / Energy","SOLAR","Solar generation, inverter and storage",2],
      ["sys-plumbing","Plumbing","PLUMBING","Water supply, heating and fixtures",3],
      ["sys-security","Security","SECURITY","Alarm, access and cameras",4],
      ["sys-structure","Structure","STRUCTURE","Building envelope, roof and drainage",5],
      ["sys-appliances","Appliances","APPLIANCES","Major household appliances",6],
      ["sys-garden","Garden / Outdoor","GARDEN","Outdoor services and irrigation",7]
    ] as const;
    const insSystem = db.prepare(
      "INSERT INTO systems(id,home_id,name,category,description,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
    );
    for (const s of systems) insSystem.run(s[0],HOME,s[1],s[2],s[3],s[4],"2024-04-13T09:00:00.000Z",NOW);

    const assets = [
      ["asset-db","sys-electrical","Main distribution board","Distribution board","Garage utility wall","Hager","Volta VU48",null,"2024-04-13",null,null,"BrightSpark Electrical",null,null,"Main household DB board",'["critical"]',"2026-09-18"],
      ["asset-inverter","sys-solar","8 kW inverter","Inverter","Garage energy wall","Sunsynk","SUN-8K-SG01LP1","INV-8K-24-0417","2025-01-21","2025-01-10",4200000,"SolarCore Gauteng","2025-01-21","2030-01-20","Hybrid inverter serving essential and non-essential loads",'["energy","warranty"]',"2026-09-22"],
      ["asset-battery","sys-solar","10 kWh battery bank","Battery","Garage energy wall","Hubble","AM-5 x2",null,"2025-01-21","2025-01-10",6900000,"SolarCore Gauteng","2025-01-21","2035-01-20","Two 5.12 kWh lithium modules",'["energy"]',"2026-09-22"],
      ["asset-array","sys-solar","Solar array","PV array","North roof","JA Solar","JAM54S31 420W",null,"2025-01-21","2025-01-10",null,"SolarCore Gauteng","2025-01-21","2037-01-20","16 panel array",'["roof","energy"]',"2026-09-22"],
      ["asset-geyser","sys-plumbing","200 L geyser","Water heater","Ceiling above passage","Kwikot","Superline 600 Dual","GY-2024-18821","2024-04-13","2024-04-03",1280000,"Mokoena Plumbing","2024-04-13","2029-04-12","200 litre electric geyser",'["hot-water"]',"2026-07-14"],
      ["asset-tap","sys-plumbing","Kitchen mixer tap","Fixture","Kitchen island","Franke","Neptune Pull-Out",null,"2024-04-13","2024-04-03",365000,"Mokoena Plumbing","2024-04-13","2029-04-12","Aerator previously blocked by sediment",'["recurring-fault"]',"2026-09-29"],
      ["asset-shutoff","sys-plumbing","Main water shutoff","Valve","South exterior wall",null,null,null,"2024-04-13",null,null,"Mokoena Plumbing",null,null,"Primary municipal-water isolation valve",'["critical"]',"2026-09-15"],
      ["asset-alarm","sys-security","Alarm panel","Alarm","Entrance cupboard","IDS","X-Series 64",null,"2024-07-02","2024-06-28",1590000,"Sentinel Security",null,null,"Eight active zones",'["security"]',"2026-09-27"],
      ["asset-gate","sys-security","Front gate motor","Gate motor","Driveway gate","Centurion","D5-Evo Smart","GT-D5-88102","2024-07-02","2024-06-28",1250000,"Sentinel Security","2024-07-02","2027-07-01","Battery replaced March 2026",'["security","access"]',"2026-09-27"],
      ["asset-camera-1","sys-security","Camera 1","Camera","Front entrance","Hikvision","DS-2CD2387G2",null,"2024-07-02",null,null,"Sentinel Security",null,null,"Front entrance camera",'["security"]',"2026-09-27"],
      ["asset-camera-2","sys-security","Camera 2","Camera","Driveway","Hikvision","DS-2CD2387G2",null,"2024-07-02",null,null,"Sentinel Security",null,null,"Driveway camera",'["security"]',"2026-09-27"],
      ["asset-camera-3","sys-security","Camera 3","Camera","Rear patio","Hikvision","DS-2CD2387G2",null,"2024-07-02",null,null,"Sentinel Security",null,null,"Rear patio camera",'["security"]',"2026-09-27"],
      ["asset-camera-4","sys-security","Camera 4","Camera","North boundary","Hikvision","DS-2CD2387G2","CAM4-99271","2024-07-02",null,null,"Sentinel Security",null,null,"Intermittent network disconnect under investigation",'["security","network"]',"2026-09-30"],
      ["asset-gutters","sys-structure","North gutters","Roof drainage","North roofline",null,null,null,"2024-04-13",null,null,null,null,null,"Leaf loading is highest along jacaranda side",'["exterior","ladder"]',"2026-06-01"],
      ["asset-fridge","sys-appliances","Refrigerator","Refrigerator","Kitchen","Samsung","RF65A967ES9","RF65-770142","2025-03-18","2025-03-15",3999900,"Retail installation","2025-03-18","2028-03-17","Family Hub refrigerator",'["kitchen","warranty"]',"2026-09-24"],
      ["asset-irrigation","sys-garden","Irrigation controller","Irrigation","Garden store","Rain Bird","ESP-TM2",null,"2025-08-09","2025-08-02",389000,null,null,null,"Imported with basic metadata; condition not yet inspected",'["outdoor"]',null]
    ] as const;
    const insAsset = db.prepare(`
      INSERT INTO assets(id,system_id,name,category,location,manufacturer,model,serial_number,
        installation_date,purchase_date,purchase_cost_cents,contractor,warranty_start,warranty_end,
        notes,tags_json,health_observed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const a of assets) insAsset.run(...a,"2024-04-13T09:00:00.000Z",NOW);

    const issues = [
      ["issue-camera-4","asset-camera-4","Camera 4 intermittent disconnect","OPEN","MEDIUM","Camera drops from the recorder several times per week. Power remains stable; network path is suspected.","2026-09-22",null],
      ["issue-tap-2025","asset-tap","Kitchen tap losing pressure","RESOLVED","MEDIUM","Pressure fell after sustained flow. Aerator contained sediment and was cleaned rather than replaced.","2025-11-05","2025-11-06"],
      ["issue-gate-battery","asset-gate","Gate motor slow under battery power","RESOLVED","LOW","Gate movement slowed during load shedding. Backup battery failed capacity test.","2026-03-09","2026-03-11"]
    ] as const;
    const insIssue = db.prepare(
      "INSERT INTO issues(id,asset_id,title,status,severity,description,detected_at,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    for (const i of issues) insIssue.run(...i,i[6] + "T08:00:00.000Z",NOW);

    const maintenance = [
      ["maint-gutters","asset-gutters","Inspect and clear north gutters",90,"2026-05-26","2026-08-24"],
      ["maint-filter","asset-tap","Inspect kitchen aerator and inlet screens",90,"2026-07-15","2026-10-13"],
      ["maint-gate","asset-gate","Inspect gate motor and battery",180,"2026-04-25","2026-10-22"],
      ["maint-inverter","asset-inverter","Clean inverter vents",180,"2026-07-01","2026-12-28"],
      ["maint-alarm","asset-alarm","Test alarm zones",180,"2026-08-15","2027-02-11"]
    ] as const;
    const insMaint = db.prepare(
      "INSERT INTO maintenance_rules(id,asset_id,title,interval_days,last_completed_at,next_due_at,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)"
    );
    for (const m of maintenance) insMaint.run(...m,"2025-01-01T09:00:00.000Z",NOW);

    const docs = [
      ["doc-inverter-warranty","Sunsynk 8 kW inverter warranty","WARRANTY","LOCAL",null,"/demo-documents/inverter-warranty.txt","text/plain","asset-inverter",null,"2025-01-21T12:00:00.000Z"],
      ["doc-inverter-invoice","Solar installation invoice SC-250121","INVOICE","LOCAL",null,"/demo-documents/solar-installation-invoice.txt","text/plain","asset-inverter",null,"2025-01-21T12:10:00.000Z"],
      ["doc-fridge-warranty","Samsung refrigerator warranty","WARRANTY","LOCAL",null,"/demo-documents/refrigerator-warranty.txt","text/plain","asset-fridge",null,"2025-03-18T11:00:00.000Z"]
    ] as const;
    const insDoc = db.prepare(
      "INSERT INTO documents(id,title,type,provider,provider_file_id,local_path,mime_type,asset_id,issue_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    );
    for (const d of docs) insDoc.run(...d,NOW);

    const events = [
      ["event-geyser-installed","ASSET_INSTALLED","Geyser installed","200 L Kwikot geyser commissioned by Mokoena Plumbing.","2024-04-13T11:30:00.000Z","asset-geyser",null,null,null],
      ["event-security-installed","ASSET_INSTALLED","Security system commissioned","Alarm, gate motor and four perimeter cameras commissioned.","2024-07-02T15:00:00.000Z","asset-alarm",null,null,null],
      ["event-solar-installed","ASSET_INSTALLED","Solar system installed","8 kW hybrid inverter, 10 kWh storage and 16-panel array commissioned.","2025-01-21T16:00:00.000Z","asset-inverter",null,null,"doc-inverter-invoice"],
      ["event-inverter-warranty","DOCUMENT_ATTACHED","Inverter warranty recorded","Five-year inverter warranty attached to the 8 kW inverter.","2025-01-21T16:10:00.000Z","asset-inverter",null,null,"doc-inverter-warranty"],
      ["event-fridge-installed","ASSET_INSTALLED","Refrigerator added","Samsung RF65A967ES9 installed in the kitchen.","2025-03-18T13:00:00.000Z","asset-fridge",null,null,"doc-fridge-warranty"],
      ["event-tap-issue","ISSUE_REPORTED","Kitchen tap pressure issue recorded","Pressure fell significantly after sustained flow.","2025-11-05T08:30:00.000Z","asset-tap","issue-tap-2025",null,null],
      ["event-tap-fixed","ISSUE_RESOLVED","Kitchen tap aerator cleaned","Sediment was removed from the aerator. Fixture replacement was not required.","2025-11-06T17:20:00.000Z","asset-tap","issue-tap-2025","maint-filter",null],
      ["event-gate-issue","ISSUE_REPORTED","Gate battery weakness recorded","Gate movement slowed during load shedding.","2026-03-09T19:00:00.000Z","asset-gate","issue-gate-battery",null,null],
      ["event-gate-fixed","ISSUE_RESOLVED","Gate motor battery replaced","Backup battery replaced after failed capacity test.","2026-03-11T10:40:00.000Z","asset-gate","issue-gate-battery","maint-gate",null],
      ["event-solar-inspection","MAINTENANCE_COMPLETED","Solar inspection logged","Array, inverter vents and battery cabinet inspected with no fault found.","2026-07-01T12:00:00.000Z","asset-inverter",null,"maint-inverter",null],
      ["event-camera-4","ISSUE_REPORTED","Camera 4 intermittent disconnect detected","Repeated recorder disconnects observed on the north-boundary camera.","2026-09-22T18:30:00.000Z","asset-camera-4","issue-camera-4",null,null],
      ["event-irrigation-added","ASSET_CREATED","Irrigation controller imported","Controller metadata added; physical condition has not yet been verified.","2026-09-28T09:15:00.000Z","asset-irrigation",null,null,null],
      ["event-tap-check","INSPECTION","Kitchen tap checked","No immediate pressure loss observed during a short flow test.","2026-09-29T17:00:00.000Z","asset-tap",null,"maint-filter",null]
    ] as const;
    const insEvent = db.prepare(`
      INSERT INTO timeline_events(id,home_id,event_type,title,summary,occurred_at,asset_id,issue_id,
        maintenance_rule_id,document_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const e of events) insEvent.run(e[0],HOME,e[1],e[2],e[3],e[4],e[5],e[6],e[7],e[8],"{}",NOW);

    db.prepare(`
      INSERT INTO timeline_events(
        id,home_id,event_type,title,summary,occurred_at,project_id,metadata_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      "event-project-battery-expansion",
      HOME,
      "PROJECT_CREATED",
      "Battery storage expansion planned",
      "Project opened to evaluate and add additional battery capacity.",
      "2026-09-30T10:00:00.000Z",
      "project-battery-expansion",
      "{}",
      NOW
    );

    db.prepare("UPDATE documents SET home_id=? WHERE home_id IS NULL").run(HOME);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
