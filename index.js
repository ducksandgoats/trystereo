const __dirname = import.meta.dirname
import path from 'path'
import Channel from '@thaunknown/simple-peer/lite.js'
import {hex2bin, bin2hex} from 'uint8-util'
import Events from 'events'
import { LocalStorage } from 'node-localstorage'

export default class Trystereo extends Events {
    constructor(url, hash, opts){
        super()
        const localStore = localStorage ? localStorage : new LocalStorage(path.join(__dirname, 'store'))
        this.id = localStore.getItem('id')
        if(!this.id){
            this.id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => {return ('0' + byte.toString(16)).slice(-2)}).join('')
            localStore.setItem('id', this.id)
        }
        this.charset = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz'
        this.opts = opts.opts && typeof(opts.opts) === 'object' && !Array.isArray(opts.opts) ? opts.opts : {}
        this.hash = hash
        this.url = url + '?info_hash=' + this.hash
        if(opts.max){
            if(typeof(opts.max) === 'number' && opts.max <= 6 && opts.max > 0){
                this.max = opts.max
            } else {
                throw new Error('max is invalid')
            }
        } else {
            this.max = 6
        }
        if(opts.min){
            if(typeof(opts.min) === 'number' && opts.min >= 1 && opts.min < 7){
                this.min = opts.min
            } else {
                throw new Error('min is invalid')
            }
        } else {
            this.min = 3
        }
        if(this.max < this.min){
            throw new Error('max is below or same as min')
        }
        if(this.min > this.max){
            throw new Error('min is above or same as max')
        }
        this.clearOnMin = Boolean(opts.clearOnMin)
        this.wsOffers = new Map()
        this.channels = new Map()
        this.tracks = new Set()
        // this.extra = new Map()
        this.socket = null
        // this.relay = false
        this.announceSeconds = opts.announceSeconds || 33 * 1000
        this.maxAnnounceSecs = opts.maxAnnounceSecs || 120 * 1000
        this.ws()
        this.timerWS = setInterval(() => {this.ws()}, this.announceSeconds)
        this.alternativeSeconds = 60 * 1000
    }
    quit(){
        this.wsOffers.forEach((data) => {
            data.destroy()
        })
        this.channels.forEach((data) => {
            data.destroy()
        })
        if(this.timerWS){
            clearInterval(this.timerWS)
        }
        if(this.socket){
            this.socket.close()
        }
        Object.keys(this).forEach((data) => {
            if(this[data] !== 'quit'){
                this[data] = null
            }
        })
    }
    initWS(){
        if(this.channels.size < this.max){
            const check = this.max - this.channels.size
            if(this.wsOffers.size < check){
                const test = check - this.wsOffers.size
                for(let i = 0;i < test;i++){
                    const testID = Array(20).fill().map(() => {return this.charset[Math.floor(Math.random() * this.charset.length)]}).join('')
                    const testChannel = new Channel({...this.opts, initiator: true, trickle: false, initData: false})
                    testChannel.offer_id = testID
                    testChannel.offer = new Promise((res) => testChannel.once('signal', res))
                    testChannel.channels = new Set()
                    this.wsOffers.set(testID, testChannel)
                }
            }
        } else {
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    if(err){
                        this.emit('error', err)
                    }
                })
            })
            this.wsOffers.clear()
        }
    }
    ws(){
        if(this.channels.size >= this.max){
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    if(err){
                        this.emit('error', err)
                    }
                })
            })
            this.wsOffers.clear()
            return
        }
        if(this.channels.size >= this.min){
            if(this.clearOnMin){
                this.wsOffers.forEach((data) => {
                    data.destroy((err) => {
                        if(err){
                            this.emit('error', err)
                        }
                    })
                })
                this.wsOffers.clear()
            }
            return
        }
        this.initWS()
        if(!this.wsOffers.size){
            return
        }
        if(this.socket){
            if(this.socket.readyState === WebSocket.OPEN){
                console.log('connected');
                (async () => {
                    const arr = [];
                    for(const val of this.wsOffers.values()){
                        arr.push({offer_id: val.offer_id, offer: await Promise.resolve(val.offer)});
                    };
                    return arr
                })()
                .then((data) => {
                    if(data.length){
                        this.socket.send(JSON.stringify({
                            action: 'announce',
                            info_hash: hex2bin(this.hash),
                            numwant: data.length,
                            peer_id: hex2bin(this.id),
                            offers: data
                        }))
                    }
                })
                .catch((e) => {
                    if(err){
                        this.emit('error', e)
                    }
                });
            } else if(this.socket.readyState === WebSocket.CONNECTING){
                console.log('connecting')
                // notify it is connecting by emitting a connecting event with connecting string
            } else if(this.socket.readyState === WebSocket.CLOSING){
                this.checkClosing()
            } else {
                delete this.socket
                this.soc()
            }
        } else {
            this.soc()
        }
    }
    soc(){
        this.socket = new WebSocket(this.url)
        const handleOpen = (e) => {
            console.log(e);
            // this.relay = true
            (async () => {
                const arr = [];
                for(const val of this.wsOffers.values()){
                    arr.push({offer_id: val.offer_id, offer: await Promise.resolve(val.offer)});
                };
                console.log('arr: ', arr.length, arr)
                return arr
            })()
            .then((data) => {
                if(data.length){
                    this.socket.send(JSON.stringify({
                        action: 'announce',
                        info_hash: hex2bin(this.hash),
                        numwant: data.length,
                        peer_id: hex2bin(this.id),
                        offers: data
                    }))
                }
            })
            .catch((e) => {
                if(err){
                    this.emit('error', e)
                }
            });
        }
        const handleMessage = (e) => {
            // console.log(e)
            let message
            try {
                message = JSON.parse(e.data)
            } catch (error) {
                this.emit('error', error)
                return
            }
            // handle message
            const msgInfoHash = message.info_hash ? bin2hex(message.info_hash) : ''
            const msgPeerId = message.peer_id ? bin2hex(message.peer_id) : ''
            // const msgToPeerId = message.to_peer_id ? bin2hex(message.to_peer_id) : ''
            if ((msgPeerId && msgPeerId === this.id) || msgInfoHash !== this.hash){
                return
            }

            if(this.channels.size >= this.max){
                this.wsOffers.forEach((data) => {data.destroy((err) => {if(err){this.emit('error', err)}})})
                this.wsOffers.clear()
                return
            }

            const errMsg = message['failure reason']

            if (errMsg) {
                if(errMsg === 'Relaying'){
                    if(message.relay){
                        this.url = message.relay + '?info_hash=' + this.hash
                        this.socket.close()
                        this.soc()
                    }
                } else {
                    this.emit('error', new Error(`torrent tracker failure from ${this.socket.url} - ${errMsg}`))
                }
                return
            }
            if(message.interval && message.interval > this.announceSeconds && message.interval <= this.maxAnnounceSecs) {
                clearInterval(this.timerWS)
                this.announceSecs = message.interval * 1000
                this.timerWS = setInterval(() => {this.ws()}, this.announceSecs)
            }
            if (message.offer && message.offer_id) {
                if (this.channels.has(msgPeerId)){
                    return
                }
            
                const peer = new Channel({...this.opts, initiator: false, trickle: false, initData: false})
            
                peer.once('signal', (answer) => {this.socket.send(JSON.stringify({ answer, action: 'announce', info_hash: hex2bin(this.hash), peer_id: hex2bin(this.id), to_peer_id: hex2bin(msgPeerId), offer_id: message.offer_id }))})
                peer.channels = new Set()
                peer.signal(message.offer)
                peer.id = msgPeerId
                this.handleChannel(peer)
                return
            }
            if (message.answer) {
                if (this.channels.has(msgPeerId)){
                    return
                }

                if(!this.wsOffers.has(message.offer_id)){
                    return
                }
        
                const offer = this.wsOffers.get(message.offer_id)
                offer.signal(message.answer)
                offer.id = msgPeerId
                this.wsOffers.delete(offer.offer_id)
                this.handleChannel(offer)
            }
        }
        const handleError = (e) => {
            this.emit('error', e)
        }
        const handleClose = (e) => {
            console.log(e)
            // this.relay = false
            handleEvent()
        }
        this.socket.addEventListener('open', handleOpen)
        this.socket.addEventListener('message', handleMessage)
        this.socket.addEventListener('error', handleError)
        this.socket.addEventListener('close', handleClose)
        const handleEvent = () => {
            this.socket.removeEventListener('open', handleOpen)
            this.socket.removeEventListener('message', handleMessage)
            this.socket.removeEventListener('error', handleError)
            this.socket.removeEventListener('close', handleClose)
        }
    }
    handleChannel(channel){
        const onConnect = () => {
            // this.dispatchEvent(new CustomEvent('connect', {detail: channel}))
            if(!this.channels.has(channel.id)){
                this.channels.set(channel.id, channel)
                this.channels.forEach((data) => {
                    if(data.id !== channel.id){
                        data.send('trystereo:add:' + channel.id)
                        channel.send('trystereo:add:' + data.id)
                    }
                })
            }
            this.emit('connect', channel)
            // channel.emit('connected', channel)
        }
        const onData = (data) => {
            data = new TextDecoder().decode(data)
            if(data.startsWith('trystereo:')){
                data = data.replace('trystereo:', '')
                if(data.startsWith('add:')){
                    const add = data.replace('add:', '')
                    if(!channel.channels.has(add)){
                        channel.channels.add(add)
                    }
                } else if(data.startsWith('sub:')){
                    const sub = data.replace('sub:', '')
                    if(channel.channels.has(sub)){
                        channel.channels.delete(sub)
                    }
                } else {
                    this.emit('error', new Error('data is invalid'))
                }
            } else {
                channel.emit('message', data)
            }
        }
        // const onStream = (stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: stream}}))
        // }
        // const onTrack = (track, stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: {track, stream}}}))
        // }
        const onError = (err) => {
            err.id = channel.id
            this.emit('error', err)
        }
        const onClose = () => {
            // this.dispatchEvent(new CustomEvent('close', {detail: channel}))
            onHandle()
            this.channels.forEach((chan) => {
                if(chan.id !== channel.id){
                    chan.send('trystereo:sub:' + channel.id)
                }
            })
            if(this.channels.has(channel.id)){
                this.channels.delete(channel.id)
            }
            this.emit('disconnect', channel)
            // channel.emit('disconnected', channel)
        }
        const onHandle = () => {
            channel.off('connect', onConnect)
            channel.off('data', onData)
            // channel.off('stream', onStream)
            // channel.off('track', onTrack)
            channel.off('error', onError)
            channel.off('close', onClose)
        }
        channel.on('connect', onConnect)
        channel.on('data', onData)
        channel.on('error', onError)
        channel.on('close', onClose)
    }
    onSend(data, id = null){
        if(id){
            if(this.channels.has(id)){
                this.channels.get(id).send(data)
            }
        } else {
            this.channels.forEach((prop) => {
                prop.send(data)
            })
        }
    }
    onMesh(id, data){
        if(this.channels.has(id)){
            const chans = this.channels.get(id)
            this.channels.forEach((chan) => {
                if(chans.id !== chan.id){
                    if(!chan.channels.has(chans.id)){
                        const test = chans.channels.intersection(chan.channels)
                        if(test.size){
                            let i = true
                            for(const prop of test.values()){
                                if(this.id > prop){
                                    i = false
                                    break
                                }
                            }
                            if(i){
                                chan.send(data)
                            }
                        } else {
                            chan.send(data)
                        }
                    }
                }
            })
        }
    }
    checkClosing(){
        setTimeout(() => {
            if(this.socket.readyState === WebSocket.CLOSED){
                delete this.socket
                this.soc()
            } else {
                setTimeout(() => {this.checkClosing()}, 1500)
            }
        }, 1500)
    }
}