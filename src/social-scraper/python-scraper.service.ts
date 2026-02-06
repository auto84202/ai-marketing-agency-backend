import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import * as fs from 'fs/promises';

export interface PythonScraperConfig {
    platform: string;
    keyword: string;
    googlePages: number;
    replyLimit: number;
    groqApiKey: string;
    jobId: string;
}

export interface ScraperProgress {
    status: string;
    progress: number;
    totalComments: number;
    totalReplies: number;
    message?: string;
}

@Injectable()
export class PythonScraperService {
    private readonly logger = new Logger(PythonScraperService.name);
    // Python scripts are in workspace root, not in backend folder
    private readonly scriptsDir = join(__dirname, '..', '..', '..', '..');
    // Use 'py' launcher on Windows, which is more reliable
    private readonly pythonCommand = process.platform === 'win32' ? 'py' : 'python3';

    async runScraper(
        config: PythonScraperConfig,
        onProgress?: (progress: ScraperProgress) => void,
    ): Promise<any> {
        const scriptPath = this.getScriptPath(config.platform);

        this.logger.log(`Running ${config.platform} scraper with keyword: ${config.keyword}`);

        return new Promise((resolve, reject) => {
            const args = [
                scriptPath,
                '--api-key', config.groqApiKey,
                '--keyword', config.keyword,
                '--google-pages', config.googlePages.toString(),
                '--reply-limit', config.replyLimit.toString(),
                '--job-id', config.jobId,
                '--headless', // Run in headless mode for server
            ];

            const pythonProcess = spawn(this.pythonCommand, args, {
                cwd: this.scriptsDir,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                },
            });

            let outputData = '';
            let errorData = '';

            pythonProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                outputData += chunk;

                // Parse progress updates from Python script
                try {
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('PROGRESS:')) {
                            const progressData = JSON.parse(line.substring(9));
                            if (onProgress) {
                                onProgress(progressData);
                            }
                        }
                    }
                } catch (err) {
                    // Ignore JSON parsing errors
                }

                this.logger.debug(`Python output: ${chunk}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                this.logger.warn(`Python error: ${data}`);
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Try to extract JSON from the last line of output
                        const lines = outputData.trim().split('\n');
                        let jsonResult = null;

                        // Check last few lines for JSON output
                        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
                            try {
                                jsonResult = JSON.parse(lines[i]);
                                if (jsonResult && typeof jsonResult === 'object') {
                                    break;
                                }
                            } catch {
                                continue;
                            }
                        }

                        if (jsonResult) {
                            resolve(jsonResult);
                        } else {
                            // If no JSON found, return success with raw output
                            resolve({
                                success: true,
                                output: outputData,
                                totalComments: 0,
                                totalReplies: 0
                            });
                        }
                    } catch {
                        // If parsing fails, return raw output
                        resolve({
                            success: true,
                            output: outputData,
                            totalComments: 0,
                            totalReplies: 0
                        });
                    }
                } else {
                    reject(new Error(`Python script exited with code ${code}: ${errorData}`));
                }
            });

            pythonProcess.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Run multiple scrapers in parallel for different platforms
     * This allows simultaneous browser instances for faster multi-platform scraping
     */
    async runParallelScrapers(
        configs: PythonScraperConfig[],
        onProgress?: (platform: string, progress: ScraperProgress) => void,
    ): Promise<Record<string, any>> {
        this.logger.log(`Running ${configs.length} scrapers in parallel`);

        const scraperPromises = configs.map(async (config) => {
            try {
                const result = await this.runScraper(config, (progress) => {
                    if (onProgress) {
                        onProgress(config.platform, progress);
                    }
                });
                return { platform: config.platform, result, error: null };
            } catch (error) {
                this.logger.error(`Scraper failed for ${config.platform}:`, error);
                return {
                    platform: config.platform,
                    result: null,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });

        const results = await Promise.all(scraperPromises);

        // Convert array to object keyed by platform
        const resultMap: Record<string, any> = {};
        for (const { platform, result, error } of results) {
            resultMap[platform] = error ? { error } : result;
        }

        return resultMap;
    }

    private getScriptPath(platform: string): string {
        const scriptMap: Record<string, string> = {
            FACEBOOK: 'facebook_scraper.py',
            LINKEDIN: 'linkedin_scraper.py',
            REDDIT: 'reddit_scraper.py',
            TWITTER: 'twitter_scraper.py',
            INSTAGRAM: 'instagram_scraper.py',
            TIKTOK: 'tiktok_scraper.py',
        };

        const scriptName = scriptMap[platform.toUpperCase()];
        if (!scriptName) {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        return join(this.scriptsDir, scriptName);
    }

    async checkPythonDependencies(): Promise<{ installed: boolean; missing: string[] }> {
        const requiredPackages = [
            'undetected-chromedriver',
            'selenium',
            'pandas',
            'groq',
            'pyperclip',
        ];

        try {
            const checkScript = `
import sys
try:
    import undetected_chromedriver
    import selenium
    import pandas
    import groq
    import pyperclip
    print("OK")
except ImportError as e:
    print(f"MISSING: {e}")
    sys.exit(1)
`;

            const result = await this.runPythonScript(checkScript);
            return { installed: true, missing: [] };
        } catch (error) {
            this.logger.error('Python dependencies check failed:', error);
            return { installed: false, missing: requiredPackages };
        }
    }

    private runPythonScript(script: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const pythonProcess = spawn(this.pythonCommand, ['-c', script]);

            let output = '';
            pythonProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    reject(new Error(`Script failed with code ${code}`));
                }
            });
        });
    }

    async setupChromeProfile(): Promise<any> {
        const scriptPath = join(this.scriptsDir, 'setup_chrome_profile.py');

        this.logger.log('Starting Chrome profile setup');

        return new Promise((resolve, reject) => {
            const pythonProcess = spawn(this.pythonCommand, [scriptPath], {
                cwd: this.scriptsDir,
                detached: true, // Run detached so it can stay open
            });

            let outputData = '';
            let errorData = '';

            pythonProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                outputData += chunk;
                this.logger.log(`Profile setup: ${chunk}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                this.logger.error(`Profile setup error: ${data.toString()}`);
            });

            // Don't wait for the process to complete - it will stay open
            // Resolve immediately after starting
            setTimeout(() => {
                resolve({
                    started: true,
                    pid: pythonProcess.pid,
                    message: 'Chrome profile setup started'
                });
            }, 1000);
        });
    }
}
