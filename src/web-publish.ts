import type { Reservation } from './types.js';

export interface ReservationDTO {
  reservationId: string; courseName: string; startISO: string;
  pax: number; customerName: string; phone?: string; status: string;
}

export function toDTOs(reservations: Reservation[]): ReservationDTO[] {
  return reservations.map(r => ({
    reservationId: r.reservationId,
    courseName: r.courseName,
    startISO: r.start.toISOString(),
    pax: r.pax,
    customerName: r.customerName,
    phone: r.phone,
    status: r.status,
  }));
}

export async function publishToWeb(url: string, secret: string, reservations: Reservation[]): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/ingest`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(toDTOs(reservations)),
  });
  if (!resp.ok) throw new Error(`web ingest failed: HTTP ${resp.status}`);
}
