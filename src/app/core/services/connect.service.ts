/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-inferrable-types */
import { Injectable } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import SimplePeer from 'simple-peer';
import SimplePeerFiles from 'simple-peer-files';
import * as url from 'url';
import { AppConfig } from '../../../environments/environment';
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { ConnectHelperService } from './connect-helper.service';
/* eslint-disable @typescript-eslint/restrict-plus-operands */
import { ElectronService } from './electron.service';
import { SettingsService } from './settings.service';
/* eslint-disable @typescript-eslint/no-misused-promises */
import { SocketService } from './socket.service';
import { TranslateService } from '@ngx-translate/core';
import { keyboard } from '@nut-tree-fork/nut-js';

@Injectable({
    providedIn: 'root',
})
export class ConnectService {
    peer1: SimplePeer.Instance;
    spf: SimplePeerFiles;
    socketSub: Subscription;
    sub2: Subscription;
    sub3: Subscription;
    videoSource;
    transfer;

    initialized = false;
    loading;
    dialog;
    connected: boolean = false;

    id: string = '';
    idArray: string[] = [];
    remoteIdArray: any = [{}, {}, {}, {}, {}, {}, {}, {}, {}];
    remoteId: string = '';
    fileLoading = false;
constructor(
    private electronService: ElectronService,
    private socketService: SocketService,
    private connectHelperService: ConnectHelperService,
    private loadingCtrl: LoadingController,
    private settingsService: SettingsService,
    private alertCtrl: AlertController
) {}
    clipboardListener() {
    const clipboard = this.electronService.clipboard;
    clipboard
        .on('text-changed', () => {
            if (this.peer1 && this.connected) {
                const currentText = clipboard.readText();
                console.log('[CONNECT] 📋 Clipboard text changed');
                this.peer1.send('clipboard-' + currentText);
            }
        })
        .on('image-changed', () => {
            const currentImage = clipboard.readImage();
            console.log('[CONNECT] 📋 Clipboard image changed');
        })
        .startWatching();
}

    setId(id) {
        if (id.length == 9) {
            const idArray = id.split('').map(number => {
                return Number(number);
            });

            idArray.forEach((number, index) => {
                this.remoteIdArray[index] = { number };
            });
        }
    }

  sendScreenSize() {
    const scaleFactor =
        process.platform === 'darwin'
            ? 1
            : this.electronService.remote.screen.getPrimaryDisplay()
                  .scaleFactor;

    const { width, height } =
        this.electronService.remote.screen.getPrimaryDisplay().size;
    
    const finalWidth = width * scaleFactor;
    const finalHeight = height * scaleFactor;
    
    console.log('[CONNECT] 📐 Sending screen size:', finalWidth, 'x', finalHeight);
    this.socketService.sendMessage(`screenSize,${finalWidth},${finalHeight}`);
}

        videoConnector() {
    this.loading.dismiss();
    const source = this.videoSource;
    const stream = source.stream;

    this.peer1 = new SimplePeer({
        initiator: true,
        stream: stream,
        config: {
            iceServers: [
                { urls: "stun:stun.relay.metered.ca:80" },
                {
                    urls: "turn:global.relay.metered.ca:80",
                    username: "63549d560f2efcb312cd67de",
                    credential: "qh7UD1VgYnwSWhmQ",
                },
                {
                    urls: "turn:global.relay.metered.ca:80?transport=tcp",
                    username: "63549d560f2efcb312cd67de",
                    credential: "qh7UD1VgYnwSWhmQ",
                },
                {
                    urls: "turn:global.relay.metered.ca:443",
                    username: "63549d560f2efcb312cd67de",
                    credential: "qh7UD1VgYnwSWhmQ",
                },
                {
                    urls: "turns:global.relay.metered.ca:443?transport=tcp",
                    username: "63549d560f2efcb312cd67de",
                    credential: "qh7UD1VgYnwSWhmQ",
                },
            ],
        },
    });
console.log('[CONNECT] ✅ SimplePeer instance created');
   this.peer1.on('signal', data => {
    console.log('[PEER] 📡 Signal generated, sending to socket...');
    this.socketService.sendMessage(data);
});

this.peer1.on('error', (err) => {
    console.error('[PEER] ❌ Error:', err);
    this.reconnect();
});

this.peer1.on('close', () => {
    console.warn('[PEER] ⚠️ Connection closed');
    this.reconnect();
});

this.peer1.on('connect', () => {
    console.log('[PEER] ✅ Connected successfully!');
    this.connected = true;
    
    // Start clipboard monitoring AFTER connection
    this.clipboardListener();
    
    this.connectHelperService.showInfoWindow();
    const win = this.electronService.window;
    win.minimize();
});


this.peer1.on('data', data => {
    if (data) {
        try {
            const fileTransfer = data.toString();
            if (fileTransfer.substr(0, 5) === 'file-') {
                const fileID = fileTransfer.substr(5);
                this.spf
                    .receive(this.peer1, fileID)
                    .then((transfer: any) => {
                        this.fileLoading = true;
                        transfer.on('progress', p => {
                            console.log('progress', p);
                        });
                        transfer.on('done', file => {
                            this.fileLoading = false;
                            console.log('done', file);
                            const element = document.createElement('a');
                            element.href = URL.createObjectURL(file);
                            element.download = file.name;
                            element.click();
                        });
                    });
                this.peer1.send(`start-${fileID}`);
                return;
            }

            if (fileTransfer.substr(0, 10) === 'clipboard-') {
                const text = fileTransfer.substr(10);
                console.log('[CONNECT] 📋 Clipboard received:', text.substring(0, 50));
                this.electronService.clipboard.writeText(text);
                return;
            }

            // Parse the data
            let text = new TextDecoder('utf-8').decode(data);
            
            // Check if it's JSON (keyboard input)
            if (text.substring(0, 1) == '{') {
                const keyData = JSON.parse(text);
                console.log('[CONNECT] ⌨️ Keyboard event:', keyData);
                
                // Pass the parsed object directly
                this.connectHelperService.handleKey(keyData);
            } else if (text.substring(0, 1) == 's') {
                // Scroll event
                console.log('[CONNECT] 📜 Scroll event');
                this.connectHelperService.handleScroll(text);
            } else {
                // Mouse event
                console.log('[CONNECT] 🖱️ Mouse event');
                this.connectHelperService.handleMouse(text);
            }
        } catch (error) {
            console.error('[CONNECT] Error handling data:', error);
        }
    }
});
    }


  async askForConnectPermission() {
    return new Promise(async resolve => {
        const alert = await this.alertCtrl.create({
            header: 'New connection',
            message: 'Do you want to accept the connection?',
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                    handler: () => {
                        resolve(false);
                    },
                },
                {
                    text: 'Accept',
                    handler: () => {
                        resolve(true);
                    },
                },
            ],
        });

        await alert.present();
    });
}

    async generateId() {
        if (this.settingsService.settings?.randomId) {
            this.id = `${this.connectHelperService.threeDigit()}${this.connectHelperService.threeDigit()}${this.connectHelperService.threeDigit()}`;
        } else {
            const nodeMachineId = this.electronService.nodeMachineId; //this.ngxService.remote.require('node-machine-id');
            const id = await nodeMachineId.machineId();
            const uniqId = parseInt(id, 36).toString().substring(3, 12);
            this.id = uniqId;
        }
        this.idArray = ('' + this.id).split('');
    }

   async init() {
    if (this.initialized) {
        return;
    }
    
    this.initialized = true;
    await this.generateId();
    console.log('[CONNECT] 🎯 Generated ID:', this.id);
    console.log('[CONNECT] Initializing socket service...');

    // Test keyboard (no dynamic import needed)
    if (this.electronService.isElectron) {
        console.log('[CONNECT] Testing keyboard...');
        try {
            await keyboard.type('test');
            console.log('[CONNECT] ✅ Keyboard working!');
        } catch (err) {
            console.error('[CONNECT] ❌ Keyboard test failed:', err);
        }
    }

    this.loading = await this.loadingCtrl.create({
        duration: 15000,
    });


        // TODO fixme
        this.electronService.remote.screen.addListener(
            'display-metrics-changed',
            () => {
                this.sendScreenSize();
            }
        );

        this.spf = new SimplePeerFiles();

        this.socketService.init();
        this.socketService.joinRoom(this.id);

     this.sub3 = this.socketService.onDisconnected().subscribe(async () => {
    console.log('[DISCONNECT] Remote peer disconnected');
    const alert = await this.alertCtrl.create({
        header: 'Info',
        message: 'Connection was terminated',
        buttons: ['OK'],
    });
    await alert.present();

    this.reconnect();
});
        this.socketSub = this.socketService
            .onNewMessage()
            .subscribe(async (data: any) => {
           console.log('[CONNECT] 📨 Socket message received:', typeof data, data);
                if (typeof data == 'string' && data == 'hi') {
                    if (this.dialog) return; 
                     this.dialog = true;
                      console.log('[CONNECT] 👋 Received connection request');
                    this.sendScreenSize();

                    if (this.settingsService.settings?.hiddenAccess) {
                        this.socketService.sendMessage('pwRequest');
                        return;
                    } else {
                        const win = this.electronService.window;
                        win.show();
                        win.focus();
                        win.restore();

                        const result = await this.askForConnectPermission();
                         this.dialog = false;

                        if (!result) {
                            this.socketService.sendMessage('decline');
                            this.loading.dismiss();
                            return;
                        }
                        this.videoConnector();
                    }
                } else if (
                    typeof data == 'string' &&
                    data.substring(0, 8) == 'pwAnswer'
                ) {
                    const pw = data.replace(data.substring(0, 9), '');
                    const pwCorrect =
                        await this.electronService.bcryptjs.compare(
                            pw,
                            this.settingsService.settings.passwordHash
                        );

                    if (pwCorrect) {
                        this.videoConnector();
                    } else {
                        this.socketService.sendMessage('pwWrong');
                        this.loading.dismiss();
                 
const alert = await this.alertCtrl.create({
    header: 'Password not correct',
    buttons: ['OK']
});
await alert.present();
                    }
                } else if (
                    typeof data == 'string' &&
                    data.startsWith('decline')
                ) {
                    this.loading.dismiss();
               } else {
    if (this.peer1) {
        console.log('[CONNECT] 🔄 Signaling peer');
        this.peer1.signal(data);
    } else {
        console.warn('[CONNECT] ⚠️ Received signal but peer not initialized yet');
    }
}
            });
    }

    replaceVideo(stream) {
        this.peer1.removeStream(this.videoSource.stream);
        this.peer1.addStream(stream);
    }

 


    async reconnect() {
        const win = this.electronService.window;
        win.restore();
        this.connected = false;
        await this.destroy();
        setTimeout(() => {
            this.init();
        }, 500);
        this.connectHelperService.closeInfoWindow();
    }

    async destroy() {
        this.initialized = false;
        await this.peer1?.destroy();
        await this.socketService?.destroy();
        await this.socketSub?.unsubscribe();
        await this.sub3?.unsubscribe();
        await this.electronService.remote.screen.removeAllListeners();
    }

    connect(id) {
        if (this.electronService.isElectronApp) {
            const appPath = this.electronService.remote.app.getAppPath();
            try {
                const BrowserWindow = this.electronService.remote.BrowserWindow;
                const win = new BrowserWindow({
                    height: 600,
                    width: 800,
                    minWidth: 250,
                    minHeight: 250,
                    titleBarStyle:
                        process.platform === 'darwin' ? 'hidden' : 'default',
                    frame: process.platform === 'darwin' ? true : false,
                    center: true,
                    show: false,
                    backgroundColor: '#252a33',
                    webPreferences: {
                        webSecurity: false,
                        nodeIntegration: true,
                        allowRunningInsecureContent: true,
                        contextIsolation: false,
                        enableRemoteModule: true,
                    } as any,
                });

                console.log('main', this.electronService.main);
                this.electronService.remote
                    .require('@electron/remote/main')
                    .enable(win.webContents);
                // this.electronService.main.enable(win.webContents);

                if (AppConfig.production) {
                    win.loadURL(
                        url.format({
                            pathname: this.electronService.path.join(
                                appPath,
                                'dist/index.html'
                            ),
                            hash: '/remote?id=' + id,
                            protocol: 'file:',
                            slashes: true,
                        })
                    );
                } else {
                    win.loadURL('http://localhost:4200/#/remote?id=' + id);
                    win.webContents.openDevTools();
                }

                win.maximize();
                win.show();
                win.on('closed', () => {});
            } catch (error) {
                console.log('error', error);
            }
        } else {
            window.open('http://192.168.1.30:4200/#/remote?id=' + id, '_blank');
        }
    }
}
