import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createSopetMcpRuntime, type SopetMcpRuntime } from './server';
import { isMcpEnabled, loadMcpConfig, mcpEndpointUrl, type McpConfig } from './config';

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private runtime: SopetMcpRuntime | null = null;
  private config: McpConfig | null = null;
  private starting: Promise<void> | null = null;

  /**
   * Must run after `app.listen` so loopback GraphQL login can succeed.
   * Failures are logged; the API keeps serving (MCP stays disabled).
   */
  async startAfterListen(): Promise<void> {
    if (!isMcpEnabled()) {
      this.logger.log('MCP disabled (set MCP_HTTP_TOKEN or MCP_ENABLED=true to enable)');
      return;
    }
    if (this.runtime) {
      return;
    }
    if (!this.starting) {
      this.starting = this.bootstrap().catch((error) => {
        this.runtime = null;
        this.config = null;
        this.starting = null;
        this.logger.error(
          `MCP failed to start — API continues without /mcp: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }
    await this.starting;
  }

  private async bootstrap(): Promise<void> {
    this.config = loadMcpConfig();
    this.runtime = await createSopetMcpRuntime({ config: this.config });
    this.logger.log(`MCP ready at ${mcpEndpointUrl(this.config)}`);
  }

  onModuleDestroy(): void {
    this.runtime = null;
    this.config = null;
    this.starting = null;
  }

  isReady(): boolean {
    return Boolean(this.runtime && this.config);
  }

  getConfig(): McpConfig {
    if (!this.config) {
      throw new Error('MCP is not enabled');
    }
    return this.config;
  }

  getRuntime(): SopetMcpRuntime {
    if (!this.runtime) {
      throw new Error('MCP is not enabled');
    }
    return this.runtime;
  }

  endpointUrl(): string {
    return mcpEndpointUrl(this.getConfig());
  }
}
