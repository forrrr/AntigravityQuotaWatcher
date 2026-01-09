/**
 * Antigravity 本地 Token 提取器
 * 从 Antigravity IDE 的本地数据库中提取已存储的 refresh_token
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 获取 Antigravity 数据库路径
 */
function getAntigravityDbPath(): string {
    const platform = os.platform();
    const home = os.homedir();

    if (platform === 'darwin') {
        return path.join(home, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
    } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Antigravity/User/globalStorage/state.vscdb');
    } else {
        return path.join(home, '.config/Antigravity/User/globalStorage/state.vscdb');
    }
}

/**
 * 检查 Antigravity 数据库是否存在
 */
export function hasAntigravityDb(): boolean {
    const dbPath = getAntigravityDbPath();
    return fs.existsSync(dbPath);
}

/**
 * 从 Antigravity 数据库提取 refresh_token
 * @returns refresh_token 或 null（如果提取失败）
 */
export async function extractRefreshTokenFromAntigravity(): Promise<string | null> {
    try {
        const dbPath = getAntigravityDbPath();

        if (!fs.existsSync(dbPath)) {
            console.log('[AntigravityTokenExtractor] Database not found:', dbPath);
            return null;
        }

        console.log('[AntigravityTokenExtractor] Attempting to extract token from:', dbPath);

        // 使用 sqlite3 CLI 读取数据
        const { stdout } = await execAsync(
            `sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'jetskiStateSync.agentManagerInitState'"`,
            { timeout: 5000 }
        );

        if (!stdout.trim()) {
            console.log('[AntigravityTokenExtractor] No login state found in database');
            return null;
        }

        // Base64 解码
        const base64Data = stdout.trim();
        const buffer = Buffer.from(base64Data, 'base64');

        // 解析 Protobuf 提取 refresh_token
        const refreshToken = parseProtobufForRefreshToken(buffer);

        if (refreshToken) {
            console.log('[AntigravityTokenExtractor] Successfully extracted refresh_token');
        } else {
            console.log('[AntigravityTokenExtractor] Failed to parse refresh_token from protobuf');
        }

        return refreshToken;
    } catch (error) {
        console.log(`[AntigravityTokenExtractor] Failed to extract refresh_token: ${error}`);
        return null;
    }
}

/**
 * 简单的 Protobuf 解析器 - 提取 refresh_token
 * refresh_token 位于 field 6 -> field 3
 */
function parseProtobufForRefreshToken(buffer: Buffer): string | null {
    try {
        // 先找到 field 6 (oauth data)
        const oauthData = findProtobufField(buffer, 6);
        if (!oauthData) {
            return null;
        }

        // 在 oauth data 中找到 field 3 (refresh_token)
        const refreshTokenBytes = findProtobufField(oauthData, 3);
        if (!refreshTokenBytes) {
            return null;
        }

        return refreshTokenBytes.toString('utf-8');
    } catch (error) {
        console.log('[AntigravityTokenExtractor] Protobuf parse error:', error);
        return null;
    }
}

/**
 * 在 Protobuf buffer 中查找指定 field number 的数据
 */
function findProtobufField(buffer: Buffer, fieldNumber: number): Buffer | null {
    let pos = 0;

    while (pos < buffer.length) {
        const { value: tag, newPos: tagEndPos } = readVarint(buffer, pos);
        if (tagEndPos >= buffer.length) {
            break;
        }

        const wireType = tag & 0x07;
        const field = tag >> 3;
        pos = tagEndPos;

        if (wireType === 2) {
            // Length-delimited (string, bytes, embedded messages)
            const { value: length, newPos: lenEndPos } = readVarint(buffer, pos);
            pos = lenEndPos;

            if (field === fieldNumber) {
                return buffer.slice(pos, pos + length);
            }
            pos += length;
        } else if (wireType === 0) {
            // Varint
            const { newPos } = readVarint(buffer, pos);
            pos = newPos;
        } else if (wireType === 1) {
            // 64-bit
            pos += 8;
        } else if (wireType === 5) {
            // 32-bit
            pos += 4;
        } else {
            // Unknown wire type, stop parsing
            break;
        }
    }

    return null;
}

/**
 * 读取 Varint 编码的整数
 */
function readVarint(buffer: Buffer, pos: number): { value: number; newPos: number } {
    let result = 0;
    let shift = 0;

    while (pos < buffer.length) {
        const byte = buffer[pos];
        result |= (byte & 0x7f) << shift;
        pos++;

        if ((byte & 0x80) === 0) {
            break;
        }
        shift += 7;
    }

    return { value: result, newPos: pos };
}
