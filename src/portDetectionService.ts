/**
 * Port detection service
 * Only retrieves ports and CSRF Token from process args.
 */

import * as vscode from 'vscode';
import { ProcessPortDetector, AntigravityProcessInfo } from './processPortDetector';

export interface PortDetectionResult {
    /** HTTPS port used by Connect/CommandModelConfigs */
    port: number;
    connectPort: number;
    /** HTTP port from extension_server_port (fallback) */
    httpPort: number;
    csrfToken: string;
    source: 'process';
    confidence: 'high';
}

export class PortDetectionService {
    private processDetector: ProcessPortDetector;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.processDetector = new ProcessPortDetector();
    }

    /**
     * Single detection method - read from process arguments.
     */
    async detectPort(): Promise<PortDetectionResult | null> {
        // Get port and CSRF Token from process args
        const processInfo: AntigravityProcessInfo | null = await this.processDetector.detectProcessInfo();

        if (!processInfo) {
            console.error('[PortDetectionService] Failed to get port and CSRF Token from process.');
            console.error('[PortDetectionService] Ensure language_server_windows_x64.exe is running.');
            return null;
        }

        console.log(`[PortDetectionService] Detected Connect port (HTTPS): ${processInfo.connectPort}`);
        console.log(`[PortDetectionService] Detected extension port (HTTP): ${processInfo.extensionPort}`);
        console.log(`[PortDetectionService] Detected CSRF Token: ${this.maskToken(processInfo.csrfToken)}`);

        return {
            // keep compatibility: port is the primary connect port
            port: processInfo.connectPort,
            connectPort: processInfo.connectPort,
            httpPort: processInfo.extensionPort,
            csrfToken: processInfo.csrfToken,
            source: 'process',
            confidence: 'high'
        };
    }

    /**
     * 遮蔽 token，只显示前6位和后4位
     */
    private maskToken(token: string): string {
        if (token.length <= 14) {
            return '***';
        }
        return `${token.substring(0, 6)}***${token.substring(token.length - 4)}`;
    }
}
