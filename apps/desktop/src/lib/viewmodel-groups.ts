// Yttrium-style viewmodel visibility groups (generated with the Rust table
// in core/src/viewmodel_groups.rs — ids must match).
import type { ViewmodelClass } from "./viewmodel-ui";

export type ViewmodelGroupInfo = {
  id: string;
  classId: ViewmodelClass;
  label: string;
};

export const VIEWMODEL_GROUPS: ViewmodelGroupInfo[] = [
  { id: "scout/scatterguns", classId: "scout", label: "Scatterguns" },
  { id: "scout/double-barrels", classId: "scout", label: "Double Barrels" },
  { id: "scout/shortstop", classId: "scout", label: "Shortstop" },
  { id: "scout/shortstop-push", classId: "scout", label: "Shortstop Push" },
  { id: "scout/primary-inspect", classId: "scout", label: "Primary Inspect" },
  { id: "scout/pistols", classId: "scout", label: "Pistols" },
  { id: "scout/throwables", classId: "scout", label: "Throwables" },
  { id: "scout/drinks", classId: "scout", label: "Drinks" },
  { id: "scout/secondary-inspect", classId: "scout", label: "Secondary Inspect" },
  { id: "scout/melee", classId: "scout", label: "Melee" },
  { id: "sniper/rifles", classId: "sniper", label: "Rifles" },
  { id: "sniper/huntsman", classId: "sniper", label: "Huntsman" },
  { id: "sniper/primary-inspect", classId: "sniper", label: "Primary Inspect" },
  { id: "sniper/smgs", classId: "sniper", label: "SMGs" },
  { id: "sniper/throwables", classId: "sniper", label: "Throwables" },
  { id: "sniper/secondary-inspect", classId: "sniper", label: "Secondary Inspect" },
  { id: "sniper/melee", classId: "sniper", label: "Melee" },
  { id: "soldier/rockets", classId: "soldier", label: "Rockets" },
  { id: "soldier/primary-inspect", classId: "soldier", label: "Primary Inspect" },
  { id: "soldier/shotguns", classId: "soldier", label: "Shotguns" },
  { id: "soldier/banners", classId: "soldier", label: "Banners" },
  { id: "soldier/bison", classId: "soldier", label: "Bison" },
  { id: "soldier/secondary-inspect", classId: "soldier", label: "Secondary Inspect" },
  { id: "soldier/melee", classId: "soldier", label: "Melee" },
  { id: "demoman/grenades", classId: "demoman", label: "Grenades" },
  { id: "demoman/primary-inspect", classId: "demoman", label: "Primary Inspect" },
  { id: "demoman/stickybombs", classId: "demoman", label: "Stickybombs" },
  { id: "demoman/secondary-inspect", classId: "demoman", label: "Secondary Inspect" },
  { id: "demoman/melee", classId: "demoman", label: "Melee" },
  { id: "medic/primaries", classId: "medic", label: "Primaries" },
  { id: "medic/primary-inspect", classId: "medic", label: "Primary Inspect" },
  { id: "medic/mediguns", classId: "medic", label: "Mediguns" },
  { id: "medic/secondary-inspect", classId: "medic", label: "Secondary Inspect" },
  { id: "medic/melee", classId: "medic", label: "Melee" },
  { id: "heavy/miniguns", classId: "heavy", label: "Miniguns" },
  { id: "heavy/primary-inspect", classId: "heavy", label: "Primary Inspect" },
  { id: "heavy/shotguns", classId: "heavy", label: "Shotguns" },
  { id: "heavy/consumables", classId: "heavy", label: "Consumables" },
  { id: "heavy/secondary-inspect", classId: "heavy", label: "Secondary Inspect" },
  { id: "heavy/melee", classId: "heavy", label: "Melee" },
  { id: "pyro/flamethrowers", classId: "pyro", label: "Flamethrowers" },
  { id: "pyro/primary-inspect", classId: "pyro", label: "Primary Inspect" },
  { id: "pyro/shotguns", classId: "pyro", label: "Shotguns" },
  { id: "pyro/flare-guns", classId: "pyro", label: "Flare Guns" },
  { id: "pyro/thermal-thruster", classId: "pyro", label: "Thermal Thruster" },
  { id: "pyro/gas-passer", classId: "pyro", label: "Gas Passer" },
  { id: "pyro/secondary-inspect", classId: "pyro", label: "Secondary Inspect" },
  { id: "pyro/melee", classId: "pyro", label: "Melee" },
  { id: "spy/revolvers", classId: "spy", label: "Revolvers" },
  { id: "spy/primary-inspect", classId: "spy", label: "Primary Inspect" },
  { id: "spy/sappers", classId: "spy", label: "Sappers" },
  { id: "spy/melee", classId: "spy", label: "Melee" },
  { id: "spy/melee-inspect", classId: "spy", label: "Melee Inspect" },
  { id: "engineer/shotguns", classId: "engineer", label: "Shotguns" },
  { id: "engineer/pomson", classId: "engineer", label: "Pomson" },
  { id: "engineer/primary-inspect", classId: "engineer", label: "Primary Inspect" },
  { id: "engineer/pistols", classId: "engineer", label: "Pistols" },
  { id: "engineer/wrangler", classId: "engineer", label: "Wrangler" },
  { id: "engineer/secondary-inspect", classId: "engineer", label: "Secondary Inspect" },
  { id: "engineer/wrenches", classId: "engineer", label: "Wrenches" },
  { id: "engineer/gunslinger", classId: "engineer", label: "Gunslinger" },
  { id: "engineer/melee-inspect", classId: "engineer", label: "Melee Inspect" },
  { id: "engineer/pda", classId: "engineer", label: "PDA" },
  { id: "engineer/toolbox", classId: "engineer", label: "Toolbox" },
];

export function viewmodelGroupsForClass(classId: ViewmodelClass): ViewmodelGroupInfo[] {
  return VIEWMODEL_GROUPS.filter((group) => group.classId === classId);
}
