import { all, get, run, nowIso } from "@/db";

export type ServiceRow = {
  id: number;
  name: string;
  description: string | null;
  image_media_id: number | null;
  link: string;
  sort: number;
  active: number;
};

export function listActiveServices(): ServiceRow[] {
  return all<ServiceRow>(`SELECT * FROM services WHERE active = 1 ORDER BY sort ASC, id ASC`);
}

export function listAllServices(): ServiceRow[] {
  return all<ServiceRow>(`SELECT * FROM services ORDER BY sort ASC, id ASC`);
}

export function getService(id: number): ServiceRow | undefined {
  return get<ServiceRow>(`SELECT * FROM services WHERE id = ?`, id);
}
