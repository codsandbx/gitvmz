const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const request = require('request');

// 可修改的配置
const SUBSCRIPTION_BASE = process.env.SUBSCRIPTION_BASE || 'Codsndbx';
const WBSEVICE_BINARY_NAME = process.env.WBSEVICE_BINARY_NAME || 'xlinx';
const FILE_PATH = process.env.FILE_PATH || './public';
const DOMAIN = process.env.DOMAIN || ''; // 默认值，部署时需覆盖
const VSPORT = parseInt(process.env.PORT) || 3000; // 使用平台 PORT
const WBSEVICE_PORT = parseInt(process.env.WBSEVICE_PORT) || 10000;
const VMSNEWTHIS_PATH = process.env.VMSNEWTHIS_PATH || '/vmsnewthis';
const KEEP_ALIVE_INTERVAL = parseInt(process.env.KEEP_ALIVE_INTERVAL) || 60000;

const DEFAULT_VMSNEWTHIS_UUID = 'd173c073-e5b2-1c0d-fc3f-ebca6e952b55';
let VMESS_UUID = DEFAULT_VMSNEWTHIS_UUID;

function isValidUuid(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return typeof uuid === 'string' && uuidRegex.test(uuid);
}

const envUuid = process.env.VMESS_UUID;
if (envUuid && isValidUuid(envUuid)) {
    VMESS_UUID = envUuid;
    console.log('Using UUID from .env:', VMESS_UUID);
} else if (!isValidUuid(VMESS_UUID)) {
    VMESS_UUID = uuidv4();
    console.log('Generated random UUID:', VMESS_UUID);
} else {
    console.log('Using default UUID:', VMESS_UUID);
}

// 创建目录
if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH);
    console.log(`${FILE_PATH} directory created`);
} else {
    console.log(`${FILE_PATH} directory already exists`);
}

// HTTP 服务（伪装页面 + WebSocket 升级）
const server = http.createServer((req, res) => {
    const indexPath = path.join(FILE_PATH, 'index.html');
    if (req.url === '/' || req.url === '/index.html') {
        if (fs.existsSync(indexPath)) {
            fs.readFile(indexPath, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500);
                    res.end('Error loading page');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(data);
                }
            });
        } else {
            res.writeHead(500);
            res.end('Pseudo page not found');
        }
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// WebSocket 服务（代理到 WBSEVICE）
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws, req) => {
    console.log('WebSocket connection attempt:', req.url);
    if (req.url === VMSNEWTHIS_PATH) {
        console.log('vmsnewthis client connected');

        let wbseviceWs;

        function connectToWbsevice() {
            console.log(`Attempting to connect to WBSEVICE at ws://127.0.0.1:${WBSEVICE_PORT}${VMSNEWTHIS_PATH}`);
            wbseviceWs = new WebSocket(`ws://127.0.0.1:${WBSEVICE_PORT}${VMSNEWTHIS_PATH}`);
            
            wbseviceWs.on('open', () => {
                console.log('Connected to WBSEVICE WebSocket');
            });

            wbseviceWs.on('message', (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                    console.log('Forwarding data from WBSEVICE to client:', data.length, 'bytes');
                    ws.send(data);
                }
            });

            wbseviceWs.on('close', () => {
                console.log('WBSEVICE WebSocket closed');
                if (ws.readyState === WebSocket.OPEN) {
                    setTimeout(connectToWbsevice, 1000);
                }
            });

            wbseviceWs.on('error', (err) => {
                console.error('WBSEVICE WebSocket error:', err);
                wbseviceWs.close();
            });
        }

        connectToWbsevice();

        ws.on('message', (msg) => {
            if (wbseviceWs.readyState === WebSocket.OPEN) {
                console.log('Forwarding data from client to WBSEVICE:', msg.length, 'bytes');
                wbseviceWs.send(msg);
            } else {
                console.log('WBSEVICE WebSocket not ready, message dropped');
            }
        });

        ws.on('close', () => {
            console.log('vmsnewthis client disconnected');
            wbseviceWs.close();
        });

        ws.on('error', (err) => {
            console.error('Client WebSocket error:', err);
        });
    } else {
        console.log('Invalid WebSocket path:', req.url);
        ws.close();
    }
});

// 下载 WBSEVICE 二进制
function downloadWbsevice(callback) {
    const wbseviceUrl = 'https://github.com/uptimwikaba/profgen/raw/refs/heads/main/bewfile/amwdeb';
    const wbseviceBinPath = path.join(FILE_PATH, WBSEVICE_BINARY_NAME);

    if (fs.existsSync(wbseviceBinPath)) {
        console.log('WBSEVICE binary already exists at', wbseviceBinPath);
        return callback(null);
    }

    console.log('Downloading WBSEVICE from', wbseviceUrl);
    const stream = fs.createWriteStream(wbseviceBinPath);
    request(wbseviceUrl)
        .pipe(stream)
        .on('close', () => {
            console.log('WBSEVICE binary downloaded to', wbseviceBinPath);
            fs.chmodSync(wbseviceBinPath, 0o775);
            console.log('WBSEVICE binary empowered at', wbseviceBinPath);
            callback(null);
        })
        .on('error', (err) => {
            console.error('Error downloading WBSEVICE:', err);
            fs.unlinkSync(wbseviceBinPath);
            callback(err);
        });
}

// 生成 WBSEVICE 配置文件
function generateWbseviceConfig(callback) {
    const config = {
        log: { loglevel: "info" },
        inbounds: [
            {
                port: WBSEVICE_PORT,
                protocol: "vmess",
                settings: { clients: [{ id: VMESS_UUID, security: "auto" }] },
                streamSettings: {
                    network: "ws",
                    wsSettings: { path: VMSNEWTHIS_PATH },
                    security: "none"
                }
            }
        ],
        outbounds: [{ protocol: "freedom" }]
    };
    const configPath = path.join(FILE_PATH, 'confg.json');
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        fs.chmodSync(configPath, 0o664);
        console.log('WBSEVICE config generated at', configPath);
        callback(null);
    } catch (err) {
        console.error('Error generating config:', err);
        callback(err);
    }
}

// 检查 WBSEVICE 是否运行
function isWbseviceRunning(callback) {
    const wbseviceBinPath = path.join(__dirname, FILE_PATH, WBSEVICE_BINARY_NAME);
    exec(`ps aux | grep ${wbseviceBinPath} | grep -v grep`, (err, stdout) => {
        if (err) {
            console.error('Error checking WBSEVICE process:', err);
            return callback(false);
        }
        const isAlive = stdout.trim().length > 0;
        console.log('WBSEVICE process check:', isAlive ? 'Running' : 'Not running');
        callback(isAlive);
    });
}

// 启动 WBSEVICE
function startWbsevice(callback) {
    const wbseviceBinPath = path.join(__dirname, FILE_PATH, WBSEVICE_BINARY_NAME);
    const configPath = path.join(__dirname, FILE_PATH, 'confg.json');
    const logPath = path.join(__dirname, FILE_PATH, 'wbsevice.log');
    const command = `${wbseviceBinPath} -c ${configPath} > ${logPath} 2>&1 &`;
    console.log('Starting WBSEVICE with command:', command);

    exec(command, (err) => {
        if (err) {
            console.error('Error executing WBSEVICE:', err);
            return callback(err);
        }
        console.log('WBSEVICE started in background');
        setTimeout(() => {
            fs.readFile(logPath, 'utf-8', (logErr, logData) => {
                if (logErr) {
                    console.error('Error reading wbsevice.log:', logErr);
                } else {
                    console.log('WBSEVICE log:', logData);
                }
                callback(null);
            });
        }, 5000);
    });
}

// 保持 WBSEVICE 活跃
function keepWbseviceAlive() {
    isWbseviceRunning((isAlive) => {
        if (!isAlive) {
            console.log('WBSEVICE not running, restarting...');
            startWbsevice((err) => {
                if (err) console.error('Failed to restart WBSEVICE:', err);
                else console.log('WBSEVICE restarted successfully');
            });
        } else {
            console.log('WBSEVICE is still running');
        }
    });
}

// 获取服务器归属地
function getLocation(callback) {
    request('http://ip-api.com/json/', (err, res, body) => {
        if (err || res.statusCode !== 200) {
            console.error('Error fetching location:', err || res.statusCode);
            return callback('UNKNOWN');
        }
        try {
            const data = JSON.parse(body);
            const countryCode = data.countryCode || 'UNKNOWN';
            console.log('Fetched location:', countryCode);
            callback(countryCode);
        } catch (parseErr) {
            console.error('Error parsing location data:', parseErr);
            callback('UNKNOWN');
        }
    });
}

// 生成 vmsnewthis 订阅链接
function generateVmsnewthisLink(callback) {
    getLocation((location) => {
        const vmess = {
            v: "2",
            ps: `${SUBSCRIPTION_BASE}-${location}-vms`,
            add: DOMAIN,
            port: "443",
            id: VMESS_UUID,
            aid: "0",
            net: "ws",
            type: "none",
            host: DOMAIN,
            path: `${VMSNEWTHIS_PATH}?ed=2560`, // 在 path 中添加 ?ed=2560
            tls: "tls",
            sni: DOMAIN
        };
        const base64Link = Buffer.from(JSON.stringify(vmess)).toString('base64');
        console.log('vmsnewthis Subscription Link:');
        console.log(`vmess://${base64Link}`);
        callback(null);
    });
}

// 主流程
function startServer() {
    const port = VSPORT;
    server.listen(port, () => {
        console.log('HTTP server running on port', port);

        downloadWbsevice((err) => {
            if (err) return console.error('Download failed:', err);
            generateWbseviceConfig((err) => {
                if (err) return console.error('Config generation failed:', err);
                startWbsevice((err) => {
                    if (err) return console.error('WBSEVICE startup failed:', err);
                    generateVmsnewthisLink((err) => {
                        if (err) console.error('Link generation failed:', err);
                        else console.log('Server initialization completed');
                    });
                    setInterval(keepWbseviceAlive, KEEP_ALIVE_INTERVAL);
                });
            });
        });

        // 定时访问防止休眠
        setInterval(() => {
            request(`https://${DOMAIN}`, (err, res) => {
                if (err) console.error('Keep-alive request failed:', err);
                else console.log('Keep-alive request sent');
            });
        }, KEEP_ALIVE_INTERVAL);
    });
}

startServer();
