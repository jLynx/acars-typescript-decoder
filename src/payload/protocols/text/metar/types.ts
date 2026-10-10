/** Core METAR values; raw groups and unsupported suffixes remain available. */
export interface MetarQuantity {
	value: number;
	unit: 'kt' | 'm/s' | 'km/h' | 'm' | 'SM' | 'ft' | '°C' | 'hPa' | 'inHg' | 'in';
	qualifier?: 'less-than' | 'greater-than' | 'at-least';
}

export interface MetarReport {
	protocol: 'METAR';
	raw: string;
	station: string;
	kind?: 'METAR' | 'SPECI';
	day: number;
	hour: number;
	minute: number;
	modifiers: string[];
	nil: boolean;
	wind?: { direction: number | 'variable' | null; speed: MetarQuantity; gust?: MetarQuantity; raw: string };
	windVariation?: { from: number; to: number; raw: string };
	visibility?: MetarQuantity & { raw: string };
	directionalVisibility?: Array<MetarQuantity & { direction: string; raw: string }>;
	cavok: boolean;
	clouds: Array<{ cover: string; height: MetarQuantity | null; type?: string; raw: string }>;
	presentWeather: Array<{ codes: string[]; description: string; raw: string }>;
	recentWeather?: MetarReport['presentWeather'];
	windShear?: Array<{ runway: string; raw: string }>;
	remarks?: MetarRemarks;
	runwayVisibility: Array<{
		runway: string;
		minimum: MetarQuantity;
		maximum?: MetarQuantity;
		tendency?: 'increasing' | 'decreasing' | 'unchanged';
		raw: string;
	}>;
	temperature?: MetarQuantity;
	dewpoint?: MetarQuantity;
	pressure?: MetarQuantity;
	noSignificantChange: boolean;
	unconsumed: string[];
	complete: boolean;
	integrity: 'unverified';
	source: { repository: string; revision: string; files: string[] };
}

/** Remark quantities retain their observation period and never replace body values. */
export interface MetarRemarks {
	raw: string;
	automation?: 'AO1' | 'AO2';
	seaLevelPressure?: MetarQuantity;
	preciseTemperature?: MetarQuantity;
	preciseDewpoint?: MetarQuantity;
	precipitation: Array<{ period: '1-hour' | '3-or-6-hour' | '24-hour'; amount: MetarQuantity; raw: string }>;
	temperatureExtrema: Array<{
		period: '6-hour' | '24-hour';
		kind: 'maximum' | 'minimum';
		temperature: MetarQuantity;
		raw: string;
	}>;
	pressureChange?: { period: '3-hour'; magnitude: MetarQuantity; tendencyCode: number; tendency: string; raw: string };
	snowDepth?: MetarQuantity;
	iceAccretion: Array<{ hours: number; depth: MetarQuantity; raw: string }>;
	unconsumed: string[];
}

export interface MetarGroup {
	rank: number;
	key: keyof MetarReport;
	value: unknown;
	append?: boolean;
	additional?: Partial<MetarReport>;
}
