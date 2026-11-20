// Car endpoints. Shapes mirror app/api/src/modules/car/store.ts.
import { enc, request } from '../../api';

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', P + path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);

export const FUELS = ['petrol', 'diesel', 'gpl', 'hybrid', 'electric'] as const;
export const SERVICE_KINDS = ['oil', 'filters', 'tyres', 'brakes', 'battery', 'timing_belt', 'inspection', 'wash', 'repair', 'other'] as const;
export const PAPER_KINDS = ['insurance', 'registration', 'technical', 'vignette', 'licence', 'other'] as const;
export const LISTING_STATUS = ['watching', 'contacted', 'seen', 'rejected', 'bought'] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];

export type Car = {
  id: string; name: string; make: string | null; model: string | null; year: number | null; plate: string | null;
  fuel: string; tank_l: number | null; status: 'owned' | 'wanted' | 'sold'; bought_on: string | null; bought_price: number | null;
  currency: string; start_km: number | null; note: string | null; is_default: boolean;
};
export type Fill = {
  id: string; car_id: string; day: string; km: number | null; litres: number | null; amount: number | null; currency: string;
  full: boolean; station: string | null; note: string | null; record_id: string | null;
  l_per_100?: number | null; price_per_l?: number | null; money_note?: string | null;
};
export type ServiceJob = {
  id: string; car_id: string; day: string; km: number | null; kind: string; title: string; amount: number | null; currency: string;
  garage: string | null; note: string | null; next_km: number | null; next_day: string | null; record_id: string | null; money_note?: string | null;
};
/** A car paper is a row in the documents register (car_id set, tag "car"); it pushes at 60/30/7/0 days and once after. */
export type Paper = {
  id: string; car_id: string; kind: string; name: string; expires_on: string | null; amount: number | null; currency: string;
  tags?: string[]; days_left?: number | null; state?: string; line?: string;
  where_kept: string | null; note: string | null; paid_on: string | null; record_id: string | null; money_note?: string | null;
};
export type Listing = {
  id: string; title: string; year: number | null; km: number | null; price: number | null; currency: string; url: string | null;
  place: string | null; status: ListingStatus; note: string | null; day: string; existing?: boolean;
};
export type KmReading = { id: string; car_id: string; day: string; km: number; note: string | null };
export type DueItem = {
  source: 'service' | 'paper'; id: string; car_id: string; kind: string; title: string;
  next_km: number | null; next_day: string | null; km_left: number | null; days_left: number | null;
  state: 'due' | 'soon' | 'later'; line: string;
};
export type Spend = { fuel: number; service: number; papers: number; total: number; currency: string; skipped: number };
export type CarFund = {
  id: string; name: string; current: number | null; target: number | null; unit: string | null; progress: number | null;
  pace_line: string | null; target_date: string | null;
};
/** fund_covers: how much of the cheapest open listing the fund covers today (null without a fund, a listing or a rate). */
export type FundCovers = { pct: number; fund_usd: number; line: string };
export type Buying = {
  fund: CarFund | null; open: number; cheapest: number | null; median: number | null; currency: string; listings: Listing[];
  fund_covers?: FundCovers | null;
};
export type Interval = { km?: number; months?: number; label: string };

export type CarOverview = {
  car: (Car & { km: number | null }) | null;
  cars: Car[];
  km_per_month?: number | null;
  economy?: { last: number | null; avg: number | null };
  this_month?: Spend;
  last_90?: Spend;
  cost_per_km?: number | null;
  monthly?: { month: string; fuel: number; service: number; papers: number }[];
  last_fill?: (Fill & { days_ago: number }) | null;
  last_service?: (ServiceJob & { days_ago: number }) | null;
  due: DueItem[];
  papers?: Paper[];
  buying: Buying;
  intervals: Record<string, Interval>;
  paper_labels: Record<string, string>;
};

/** The one line on the Life hub card. */
export type CarGlance = {
  car: string | null; km: number | null; due: number; soon: number; next: string | null;
  month_spend: number | null; currency?: string; fund: CarFund | null; listings: number;
};

export type CarInput = Partial<Omit<Car, 'id' | 'is_default'>> & { is_default?: boolean };
export type FuelInput = { day?: string; km?: number; litres?: number; amount?: number; price_per_l?: number; full?: boolean; station?: string; note?: string };
export type ServiceInput = { day?: string; km?: number; kind?: string; title?: string; amount?: number; garage?: string; note?: string; next_km?: number | null; next_day?: string | null };
export type PaperInput = { kind?: string; name?: string; expires_on?: string; amount?: number; paid_on?: string; where_kept?: string; note?: string };
export type ListingInput = { title?: string; year?: number; km?: number; price?: number; currency?: string; url?: string; place?: string; status?: ListingStatus; note?: string };

type Gone = { id: string; deleted: boolean };

export const carApi = {
  overview: () => get<CarOverview>('/car'),
  addCar: (b: CarInput) => post<Car>('/car/cars', b),
  updateCar: (id: string, b: CarInput) => patch<Car>(`/car/cars/${enc(id)}`, b),
  removeCar: (id: string) => del<Gone>(`/car/cars/${enc(id)}`),
  km: () => get<KmReading[]>('/car/km'),
  logKm: (km: number, day?: string) => post<KmReading>('/car/km', { km, day }),
  removeKm: (id: string) => del<Gone>(`/car/km/${enc(id)}`),
  fuel: () => get<Fill[]>('/car/fuel'),
  addFuel: (b: FuelInput) => post<Fill>('/car/fuel', b),
  removeFuel: (id: string) => del<Gone>(`/car/fuel/${enc(id)}`),
  service: () => get<ServiceJob[]>('/car/service'),
  addService: (b: ServiceInput) => post<ServiceJob>('/car/service', b),
  updateService: (id: string, b: ServiceInput) => patch<ServiceJob>(`/car/service/${enc(id)}`, b),
  removeService: (id: string) => del<Gone>(`/car/service/${enc(id)}`),
  papers: () => get<Paper[]>('/car/papers'),
  addPaper: (b: PaperInput) => post<Paper>('/car/papers', b),
  renewPaper: (id: string, b: { expires_on: string; amount?: number }) => post<Paper>(`/car/papers/${enc(id)}/renew`, b),
  removePaper: (id: string) => del<Gone>(`/car/papers/${enc(id)}`),
  listings: (status?: string) => get<Listing[]>(`/car/listings${status ? `?status=${enc(status)}` : ''}`),
  addListing: (b: ListingInput) => post<Listing>('/car/listings', b),
  updateListing: (id: string, b: ListingInput) => patch<Listing>(`/car/listings/${enc(id)}`, b),
  removeListing: (id: string) => del<Gone>(`/car/listings/${enc(id)}`),
};

export const SERVICE_LABEL: Record<string, string> = {
  oil: 'Oil change', filters: 'Filters', tyres: 'Tyres', brakes: 'Brakes', battery: 'Battery', timing_belt: 'Timing belt',
  inspection: 'Inspection', wash: 'Wash', repair: 'Repair', other: 'Other',
};
export const PAPER_LABEL: Record<string, string> = {
  insurance: 'Insurance', registration: 'Registration (carte grise)', technical: 'Technical check (contrôle technique)',
  vignette: 'Vignette', licence: 'Driving licence', other: 'Other paper',
};
export const LISTING_LABEL: Record<ListingStatus, string> = {
  watching: 'Watching', contacted: 'Contacted', seen: 'Seen', rejected: 'Rejected', bought: 'Bought',
};
