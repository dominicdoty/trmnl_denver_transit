export interface Config {
  agencies: Array<{
    url: string;
  }>;
  ignoreDuplicates: boolean;
  exclude: string[];
  db?: any;
}

export declare const GTFSRT_URL: string;
