import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    Input,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AlertController, ModalController } from '@ionic/angular';
import {
    fadeInDownOnEnterAnimation,
    fadeOutUpOnLeaveAnimation,
} from 'angular-animations';
import { AnimationOptions } from 'ngx-lottie';
import SimplePeer from 'simple-peer';
import SimplePeerFiles from 'simple-peer-files';
import 'webrtc-adapter';
import { SocketService } from '../../app/core/services/socket.service';
import { AppService } from './../../app/core/services/app.service';
import { ElectronService } from '../../app/core/services/electron.service';

@Component({
    template: `
        <ion-header>
            <ion-toolbar color="primary">
                <ion-title>{{ 'Enter Password' | translate }}</ion-title>
            </ion-toolbar>
        </ion-header>
        <ion-content>
            <div class="p-5">
                <ion-input
                    [label]="'Password' | translate"
                    [(ngModel)]="pw"
                    label-placement="floating"
                    fill="solid"
                    placeholder="Enter text"></ion-input>
            </div>
        </ion-content>
        <ion-footer>
            <ion-toolbar>
                <ion-button (click)="cancel()">
                    {{ 'Cancel' | translate }}
                </ion-button>
                <ion-button
                    cdkFocusInitial
                    (click)="connect()">
                    {{ 'Connect' | translate }}
                </ion-button>
            </ion-toolbar>
        </ion-footer>
    `,
})
export class PwDialog {
    @Input() pw = '';

    @HostListener('document:keydown.enter', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();
        this.connect();
    }

    constructor(private modalCtrl: ModalController) {}

    connect() {
        return this.modalCtrl.dismiss(this.pw);
    }

    cancel() {
        return this.modalCtrl.dismiss(null);
    }
}

@Component({
    selector: 'app-remote',
    templateUrl: './remote.page.html',
    styleUrls: ['./remote.page.scss'],
    animations: [
        fadeInDownOnEnterAnimation({ duration: 150 }),
        fadeOutUpOnLeaveAnimation({ duration: 150 }),
    ],
})
export class RemotePage implements OnInit, OnDestroy {
    signalData = '';
    peer2: SimplePeer.Instance;
    spf: SimplePeerFiles;
    userId = 'browser';
    video: HTMLVideoElement;
    stream: any;
    videoSize;
    hostScreenSize;

    showOptions = false;
    connected = false;
    fileDrop = false;
    fileLoading = false;
    cursor = true;
    transfer;
    files: any = {};

    fileProgress = 0;

    options: AnimationOptions | any = {
        path: '/assets/animations/lf30_editor_PsHnfk.json',
        loop: true,
    };

    // bound listener references so we can remove them correctly
    private boundMouseListener: any;
    private boundMouseMoveListener: any;
    private boundDblClickListener: any;
    private boundMouseUpListener: any;
    private boundMouseDownListener: any;

    @HostListener('document:dragover', ['$event'])
    onDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        this.fileDrop = true;
    }

    @HostListener('document:dragleave', ['$event'])
    onDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        this.fileDrop = false;
    }

    @HostListener('drop', ['$event'])
    ondrop(evt) {
        evt.preventDefault();
        evt.stopPropagation();
        this.fileDrop = false;
        const f = (evt as DragEvent).dataTransfer?.files;
        if (f && f.length > 0) {
            for (let i = 0; i < f.length; i++) {
                const file = f[i];
                const fileID = file.name + file.size;
                this.files[fileID] = file;
                this.peer2.send('file-' + fileID);
            }
        }
    }

    @HostListener('contextmenu', ['$event'])
    oncontextmenu(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    @HostListener('document:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        if (this.connected) {
            event.preventDefault();
            event.stopPropagation();
            this.keydownListener(event);
        }
    }

    @HostListener('mousewheel', ['$event'])
    onScroll(event: WheelEvent) {
        if (this.connected) {
            event.preventDefault();
            event.stopPropagation();
            this.scrollListener(event);
        }
    }

    @HostListener('window:resize', ['$event'])
    onResize() {
        this.calcVideoSize();
    }

    @HostListener('document:paste', ['$event'])
    onPaste(event: ClipboardEvent) {
        const text: string | undefined = event?.clipboardData?.getData('text');
        if (this.peer2 && text) {
            this.peer2.send('clipboard-' + text);
        }
    }

    constructor(
        private socketService: SocketService,
        private elementRef: ElementRef,
        private appService: AppService,
        private route: ActivatedRoute,
        public electronService: ElectronService,
        private modalCtrl: ModalController,
        private cdr: ChangeDetectorRef,
        private alertCtrl: AlertController
    ) {}

    fileChangeEvent(event) {
        const e = event.files;
        const file = e[0];
        const fileID = file.name + file.size;
        this.files[fileID] = file;
        this.peer2.send('file-' + fileID);
    }

    pwPrompt() {
        return new Promise<string>(async resolve => {
            const modal = await this.modalCtrl.create({
                component: PwDialog,
            });
            modal.present();

            const { data } = await modal.onWillDismiss();
            resolve(data);
        });
    }

    async ngOnInit() {
    // DON'T initialize clipboard here - peer2 doesn't exist yet!
    
    let id = this.route.snapshot.queryParams.id;
    if (!id) {
        const alert = await this.alertCtrl.create({
            backdropDismiss: false,
            header: 'Partner ID',
            message: 'Enter your partner ID',
            inputs: [
                {
                    name: 'id',
                    type: 'number',
                    placeholder: '863059898',
                },
            ],
            buttons: [
                {
                    text: 'Connect',
                    handler: event => {
                        console.log('[REMOTE] ID entered:', event.id);
                        id = event.id;
                        this.init(id);
                    },
                },
            ],
        });

        await alert.present();
    } else {
        this.init(id);
    }
}
    // async ngOnInit() {
    //     if (this.electronService.isElectron) {
    //         const clipboard = this.electronService.clipboard;
    //         clipboard
    //             .on('text-changed', () => {
    //                 const currentText = clipboard.readText();
    //                 console.log('currentText', currentText);
    //                 this.peer2.send('clipboard-' + currentText);
    //             })

    //             .on('image-changed', () => {
    //                 const currentIMage = clipboard.readImage();
    //                 console.log('currentText', currentIMage);
    //             })
    //             .startWatching();
    //     }

    //     let id = this.route.snapshot.queryParams.id;
    //     if (!id) {
    //         const alert = await this.alertCtrl.create({
    //             backdropDismiss: false,
    //             header: 'Partner ID',
    //             message: 'Geben Sie die ID Ihres Partners ein.',
    //             inputs: [
    //                 {
    //                     name: 'id',
    //                     type: 'number',
    //                     placeholder: '555555555',
    //                 },
    //             ],
    //             buttons: [
    //                 {
    //                     text: 'Verbinden',
    //                     handler: event => {
    //                         console.log('event', event);
    //                         id = event.id;
    //                         this.init(id);
    //                     },
    //                 },
    //             ],
    //         });

    //         await alert.present();
    //     } else {
    //         this.init(id);
    //     }
    // }

    init(id) {
    console.log('[REMOTE] 🎯 Initializing with ID:', id);
    this.appService.sideMenu = false;
    
    if (this.electronService.isElectron) {
        this.spf = new SimplePeerFiles();
    }

    this.socketService.init();
    
    // Wait for socket to actually connect before proceeding
    const connectSub = this.socketService.socket.on('connect', () => {
        console.log('[REMOTE] ✅ Socket connected, joining room:', id);
        this.socketService.joinRoom(id);
        
        // Wait a bit for room join to complete, then send hi
        setTimeout(() => {
            console.log('[REMOTE] 👋 Sending "hi" to host');
            this.socketService.sendMessage('hi');
        }, 500); // Increased from 100ms to 500ms
    });

    this.socketService.onNewMessage().subscribe(async (data: any) => {
        console.log('[REMOTE] 📨 Message received:', typeof data === 'string' ? data.substring(0, 30) : 'signal');

        if (typeof data == 'string' && data?.startsWith('screenSize')) {
            const size = data.split(',');
            this.hostScreenSize = {
                height: +size[2],
                width: +size[1],
            };
            console.log('[REMOTE] 📐 Host screen size:', this.hostScreenSize);
        } else if (typeof data == 'string' && data?.startsWith('pwRequest')) {
            console.log('[REMOTE] 🔒 Password requested');
            this.askForPw();
        } else if (typeof data == 'string' && data?.startsWith('decline')) {
            console.log('[REMOTE] ❌ Connection declined');
            this.close();
            this.cdr.detectChanges();
        } else if (typeof data == 'string' && data?.startsWith('pwWrong')) {
            console.log('[REMOTE] ⚠️ Password incorrect');
            const alert = await this.alertCtrl.create({
                header: 'Password not correct',
                buttons: ['OK']
            });
            await alert.present();
            this.askForPw();
            this.cdr.detectChanges();
        } else {
            console.log('[REMOTE] 🔄 Received WebRTC signal');
            this.peer2.signal(data);
        }
    });

    this.initPeer(id);
}

    async askForPw() {
        const pw: string = await this.pwPrompt();
        if (pw) {
            this.socketService.sendMessage(`pwAnswer:${pw}`);
        } else {
            this.socketService.sendMessage('decline');
            this.close();
        }
        this.cdr.detectChanges();
    }

  initPeer(id) {
    console.log('[REMOTE] 🌐 Creating peer connection...');
    
    this.peer2 = new SimplePeer({
        initiator: false, // Remote is NOT the initiator
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

    this.peer2.on('signal', data => {
        console.log('[REMOTE] 📡 Sending signal to host');
        this.socketService.sendMessage(data);
    });
    
    this.peer2.on('stream', stream => {
        console.log('[REMOTE] 🎥 Stream received!');
        this.connected = true;
        
if (this.electronService.isElectron) {
        console.log('[REMOTE] 📋 Starting clipboard monitoring');
        const clipboard = this.electronService.clipboard;
        clipboard
            .on('text-changed', () => {
                if (this.peer2 && this.connected) {
                    const currentText = clipboard.readText();
                    console.log('[REMOTE] 📋 Clipboard text changed');
                    this.peer2.send('clipboard-' + currentText);
                }
            })
            .on('image-changed', () => {
                const currentImage = clipboard.readImage();
                console.log('[REMOTE] 📋 Clipboard image changed');
            })
            .startWatching();
    }

    const videoBg: HTMLVideoElement =
        this.elementRef.nativeElement.querySelector('#videobg');
    videoBg.srcObject = stream;
    videoBg.play();


            const video: HTMLVideoElement =
                this.elementRef.nativeElement.querySelector('#video');
            this.video = video;
            this.stream = stream;
            if (video) {
                video.srcObject = stream;
                video.play().catch(()=>{});

                // bind listeners once and store references
                this.boundMouseListener = this.mouseListener.bind(this);
                this.boundMouseMoveListener = this.mouseMoveListener.bind(this);
                this.boundDblClickListener = this.mouseListener.bind(this);
                this.boundMouseUpListener = this.mouseListener.bind(this);
                this.boundMouseDownListener = this.mouseListener.bind(this);

                video.addEventListener('mousedown', this.boundMouseDownListener);
                video.addEventListener('mouseup', this.boundMouseUpListener);
                video.addEventListener('dblclick', this.boundDblClickListener);
                video.addEventListener('mousemove', this.boundMouseMoveListener);

                video.addEventListener(
                    'loadeddata',
                    () => {
                        this.calcVideoSize();
                    },
                    false
                );

                video.addEventListener(
                    'resize',
                    () => {
                        const w = video.videoWidth;
                        const h = video.videoHeight;

                        if (w && h) {
                            video.style.width = w.toString();
                            video.style.height = h.toString();
                        }
                    },
                    false
                );
            }
        });
        this.peer2.on('close', () => {
            this.close();
        });
        this.peer2.on('error', (err) => {
            console.error('peer error', err);
            this.close();
        });
        this.peer2.on('data', async data => {
            if (!data) return;
            const fileTransfer = data.toString();

            if (fileTransfer.substr(0, 5) === 'file-') {
                const fileID = fileTransfer.substr(5);
                this.spf
                    .receive(this.peer2, fileID)
                    .then((transfer: any) => {
                        transfer.on('progress', p => {
                            console.log('progress', p);
                        });
                        transfer.on('done', done => {
                            console.log('done', done);
                        });
                    });
                this.peer2.send(`start-${fileID}`);
                return;
            } else if (fileTransfer.substr(0, 6) === 'start-') {
                this.fileLoading = true;
                this.cdr.detectChanges();
                const fileID = fileTransfer.substr(6);
                this.transfer = await this.spf.send(
                    this.peer2,
                    fileID,
                    this.files[fileID]
                );
                this.transfer.on('progress', p => {
                    this.fileProgress = p;
                });
                this.transfer.on('done', done => {
                    this.fileLoading = false;
                    this.cdr.detectChanges();
                });
                this.transfer.on('cancel', done => {
                    this.fileLoading = false;
                    this.cdr.detectChanges();
                });
                this.transfer.on('cancelled', done => {
                    this.fileLoading = false;
                    this.cdr.detectChanges();
                });
                try {
                    this.transfer.start();
                } catch (error) {}
                return;
            }

            // other messages: e.g., clipboard, etc. (handled above)
        });
    }

    close() {
        this.connected = false;
        this.removeEventListeners();
        try {
            this.electronService.window.close();
        } catch (err) {
            // fallback
            console.warn('window.close failed', err);
        }
    }

   calcVideoSize() {
    if (!this.video) {
        console.warn('[REMOTE] ⚠️ Video element not ready yet');
        return;
    }
    
    this.videoSize = this.video.getBoundingClientRect();
    
    console.log('[REMOTE] 📏 Video size:', this.videoSize);
    console.log('[REMOTE] 📐 Host screen size:', this.hostScreenSize);
    
    if (!this.hostScreenSize) {
        console.warn('[REMOTE] ⚠️ Host screen size not received yet');
    }
}

    ngOnDestroy() {
        this.appService.sideMenu = true;
        this.removeEventListeners();
        try { this.socketService?.destroy(); } catch (err) {}
        try { this.peer2?.destroy(); } catch (err) {}
    }

    getFileProgress(fileProgress) {
        return fileProgress ? fileProgress.toFixed() : '';
    }

    removeEventListeners() {
        // remove listeners using stored bound functions
        if (this.video) {
            if (this.boundMouseDownListener) this.video.removeEventListener('mousedown', this.boundMouseDownListener);
            if (this.boundMouseUpListener) this.video.removeEventListener('mouseup', this.boundMouseUpListener);
            if (this.boundDblClickListener) this.video.removeEventListener('dblclick', this.boundDblClickListener);
            if (this.boundMouseMoveListener) this.video.removeEventListener('mousemove', this.boundMouseMoveListener);
        }
    }

   mouseListener(event: MouseEvent) {
    if (!this.connected) {
        return;
    }
    
    if (!this.hostScreenSize || !this.videoSize) {
        console.warn('[REMOTE] ⚠️ Screen dimensions not ready, ignoring mouse event');
        return;
    }
    
    let type: string;
    if (event.type == 'mouseup') {
        type = 'mu';
    } else if (event.type == 'mousedown') {
        type = 'md';
    } else if (event.type == 'dblclick') {
        type = 'dc';
    }
    
    const x = this.scale(
        event.offsetX,
        0,
        this.videoSize.width,
        0,
        this.hostScreenSize.width
    );

    const y = this.scale(
        event.offsetY,
        0,
        this.videoSize.height,
        0,
        this.hostScreenSize.height
    );

    console.log('[REMOTE] 🖱️ Mouse event:', type, 'at', x, y);

    const stringData = `${type},${x},${y},${event.button}`;
    this.peer2?.send(stringData);
}
    mouseMoveListener(event) {
        if (!this.connected) {
            return;
        }
        const x = this.scale(
            event?.offsetX,
            0,
            this.videoSize?.width || 1,
            0,
            this.hostScreenSize?.width || 1
        );
        const y = this.scale(
            event?.offsetY,
            0,
            this.videoSize?.height || 1,
            0,
            this.hostScreenSize?.height || 1
        );

        const stringData = `mm,${x},${y}`;
        this.peer2?.send(stringData);
    }

 keydownListener(event: KeyboardEvent) {
    if (!this.connected) return;
    const data = {
        t: 'k',
        code: event.code,
        keyCode: event.keyCode,
        key: event.key,
        shift: event.shiftKey,
        control: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
    };
    try {
        this.peer2?.send(JSON.stringify(data));
    } catch (err) {
        console.error('send key error', err);
    }
}

    scrollListener(event: WheelEvent) {
        if (!this.connected) return;
        let stringData;
        if (event.deltaY < 0) {
            stringData = `s,up`;
        } else if (event.deltaY > 0) {
            stringData = `s,down`;
        }
        this.peer2?.send(stringData);
    }

    scale(x, fromLow, fromHigh, toLow, toHigh) {
        // avoid division by zero
        if (!fromHigh || fromHigh === fromLow) return Math.trunc(toLow);
        return Math.trunc(((x - fromLow) * (toHigh - toLow)) / (fromHigh - fromLow) + toLow);
    }
}
