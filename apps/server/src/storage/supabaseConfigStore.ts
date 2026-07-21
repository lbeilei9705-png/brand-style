export interface RemoteConfigStore<TConfig> {
  enabled: boolean;
  read(): Promise<TConfig | undefined>;
  write(config: TConfig): Promise<void>;
}

interface SupabaseConfigStoreOptions {
  url: string;
  serviceRoleKey: string;
  tableName?: string;
  rowId?: string;
}

export class SupabaseConfigStore<TConfig> implements RemoteConfigStore<TConfig> {
  readonly enabled: boolean;
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;
  private readonly rowId: string;

  constructor(options: SupabaseConfigStoreOptions) {
    const url = options.url.replace(/\/+$/, "");
    this.serviceRoleKey = options.serviceRoleKey;
    this.rowId = options.rowId || "default";
    this.restUrl = `${url}/rest/v1/${options.tableName || "brand_style_config"}`;
    this.enabled = Boolean(url && this.serviceRoleKey);
  }

  async read(): Promise<TConfig | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const response = await fetch(`${this.restUrl}?id=eq.${encodeURIComponent(this.rowId)}&select=payload`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`读取 Supabase 配置失败：HTTP ${response.status}`);
    }

    const rows = await response.json() as Array<{ payload?: TConfig }>;
    return rows[0]?.payload;
  }

  async write(config: TConfig): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const response = await fetch(`${this.restUrl}?on_conflict=id`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        id: this.rowId,
        payload: config,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`写入 Supabase 配置失败：HTTP ${response.status}`);
    }
  }

  private headers(): HeadersInit {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
    };
  }
}
