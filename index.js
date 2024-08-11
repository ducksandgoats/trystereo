import Channel from '@thaunknown/simple-peer/lite.js'
import {hex2bin, bin2hex} from 'uint8-util'
import Events from 'events'

export default class Trystereo extends Events {
    constructor(url, hash, opts){
        super()
        this.id = localStorage.getItem('id')
        if(!this.id){
            this.id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => {return ('0' + byte.toString(16)).slice(-2)}).join('')
            localStorage.setItem('id', this.id)
        }
        this.charset = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz'
        this.opts = opts.opts && typeof(opts.opts) === 'object' && !Array.isArray(opts.opts) ? opts.opts : {}
        this.jsonParse = Boolean(opts.jsonParse)
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
        this.wsOffers = new Map()
        this.channels = new Map()
        // this.extra = new Map()
        this.socket = null
        // this.relay = false
        this.announceSeconds = opts.announceSeconds || 33 * 1000
        this.maxAnnounceSecs = opts.maxAnnounceSecs || 120 * 1000
        this.ws()
        this.timerWS = setInterval(() => {this.ws()}, this.announceSeconds)
        this.alternativeSeconds = 60 * 1000
        this.handler = opts.handler && typeof(opts.handler) === 'function' ? opts.handler : null
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
                    console.error(err)
                })
            })
            this.wsOffers.clear()
        }
    }
    ws(){
        if(this.channels.size >= this.min){
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.wsOffers.clear()
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
                    console.error(e)
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
                console.error(e)
            });
        }
        const handleMessage = (e) => {
            console.log(e)
            let message
            try {
                message = JSON.parse(e.data)
            } catch (error) {
                console.error(error)
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
                this.wsOffers.forEach((data) => {data.destroy((err) => {if(err){console.error(err)}})})
                this.wsOffers.clear()
                return
            }

            const errMsg = message['failure reason']

            if (errMsg) {
                console.error(`torrent tracker failure from ${this.socket.url} - ${errMsg}`)
                if(errMsg === 'Relaying'){
                if(message.relay){
                    this.url = message.relay + '?info_hash=' + this.hash
                    this.socket.close()
                    this.soc()
                }
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
            console.error(e)
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
                channel.unsend = new Set()
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
                        for(const chan of this.channels.values()){
                            if(channel.id !== chan.id){
                                if(chan.channels.has(add)){
                                    channel.send('trystereo:unsend:' + add)
                                    if(!channel.unsend.has(add)){
                                        channel.unsend.add(add)
                                    }
                                    // if(this.extra.has(data)){
                                    //     this.extra.set(data, this.extra.get(data) + 1)
                                    // } else {
                                    //     this.extra.set(data, 1)
                                    // }
                                    break
                                }
                            }
                        }
                    }
                } else if(data.startsWith('sub:')){
                    const sub = data.replace('sub:', '')
                    if(channel.channels.has(sub)){
                        channel.channels.delete(sub)
                        if(!channel.unsend.has(sub)){
                            for(const chan of this.channels.values()){
                                if(channel.id !== chan.id){
                                    if(chan.channels.has(sub)){
                                        chan.send('trystereo:send:' + sub)
                                        if(chan.unsend.has(sub)){
                                            chan.unsend.delete(sub)
                                        }
                                        // if(this.extra.has(data)){
                                        //     const crunch = this.extra.get(data) - 1
                                        //     if(crunch){
                                        //         this.extra.set(data, crunch)
                                        //     } else {
                                        //         this.extra.delete(data)
                                        //     }
                                        // } else {
                                        //     console.error('should have an extra user but did not find any')
                                        // }
                                        break
                                    }
                                }
                            }
                        }
                    }
                } else if(data.startsWith('unsend:')){
                    const unsendVar = data.replace('unsend:', '')
                    if(!channel.unsend.has(unsendVar)){
                        channel.unsend.add(unsendVar)
                    }
                } else if(data.startsWith('send:')){
                    const sendVar = data.replace('send:', '')
                    if(channel.unsend.has(sendVar)){
                        channel.unsend.delete(sendVar)
                    }
                } else {
                    console.error('data is invalid')
                }
            } else {
                if(this.jsonParse){
                    try {
                        data = JSON.parse(data)
                        this.onData(channel, data)
                        if(this.handler){
                            if(this.handler.constructor.name === 'AsyncFunction'){
                                this.handler(data).then((res) => {this.emit('data', res)}).catch((e) => {console.error(e)})
                            } else {
                                data = this.handler(data)
                                this.emit('data', data)
                            }
                        } else {
                            this.emit('data', data)
                        }
                    } catch (err) {
                        console.error(err)
                    }
                } else {
                    this.onData(channel, data)
                    if(this.handler){
                        if(this.handler.constructor.name === 'AsyncFunction'){
                            this.handler(data).then((res) => {this.emit('data', res)}).catch((e) => {console.error(e)})
                        } else {
                            data = this.handler(data)
                            this.emit('data', data)
                        }
                    } else {
                        this.emit('data', data)
                    }
                }
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
            channel.channels.forEach((id) => {
                if(!channel.unsend.has(id)){
                    for(const chan of this.channels.values()){
                        if(channel.id !== chan.id){
                            if(chan.channels.has(id)){
                                chan.send('trystereo:send:' + id)
                                if(chan.unsend.has(id)){
                                    chan.unsend.delete(id)
                                }
                                break
                            }
                        }
                    }
                }
            })
            this.channels.forEach((chan) => {
                if(chan.id !== channel.id){
                    chan.send('trystereo:sub:' + channel.id)
                }
            })
            if(this.channels.has(channel.id)){
                this.channels.delete(channel.id)
            }
            if(this.channels.size < this.min){
                this.ws()
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
    handleSession(chans, data){
        this.channels.forEach((chan) => {
            if(chan.id !== chans.id){
                if(!chans.channels.has(chan.id)){
                    // if(!chans.channels.intersection(chan.channels).size){
                    //     chan.send(data)
                    // }
                    chan.send(data)
                }
            }
        })
    }
    onSend(data){
        this.channels.forEach((prop) => {
            prop.send(data)
        })
    }
    onData(channel, data){
        this.channels.forEach((chan) => {
            if(channel.id !== chan.id){
                if(!chan.channels.has(channel.id) && !chan.unsend.has(channel.id)){
                    chan.send(data)
                }
            }
        })
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