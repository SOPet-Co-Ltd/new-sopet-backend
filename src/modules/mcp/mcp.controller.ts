import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../../common/decorators';
import { bearerMatches } from './http-auth';
import { isMcpEnabled, mcpEndpointUrl } from './config';
import { McpService } from './mcp.service';

@Public()
@SkipThrottle()
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcp: McpService) {}

  @Get()
  discovery() {
    this.assertEnabled();
    const config = this.mcp.getConfig();
    return {
      name: 'sopet-admin-mcp',
      version: '0.1.0',
      transport: 'streamable-http',
      mcpUrl: mcpEndpointUrl(config),
      auth: 'Authorization: Bearer <MCP_HTTP_TOKEN>',
      note: 'Same host as GraphQL — POST to mcpUrl with the bearer token.',
    };
  }

  @Post()
  @HttpCode(200)
  async handlePost(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    this.assertEnabled();
    this.assertBearer(authorization);

    const runtime = this.mcp.getRuntime();
    const server = runtime.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      this.logger.error('MCP HTTP error', error instanceof Error ? error.stack : String(error));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

  private assertEnabled(): void {
    if (!isMcpEnabled() || !this.mcp.isReady()) {
      throw new NotFoundException({
        code: 'MCP_DISABLED',
        message: 'MCP is not enabled on this server',
      });
    }
  }

  private assertBearer(authorization: string | undefined): void {
    const expected = this.mcp.getConfig().httpToken;
    if (!bearerMatches(authorization, expected)) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing MCP bearer token',
      });
    }
  }
}
