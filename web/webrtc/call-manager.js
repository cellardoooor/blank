/**
 * CallManager class for managing WebRTC calls
 * Handles call lifecycle: start, join, leave, end, reject
 */
class CallManager {
  constructor(webSocket, userId) {
    this.ws = webSocket;
    this.userId = userId;
    this.activeCall = null;
    this.peerConnections = new Map(); // userId -> PeerConnection
    this.callType = 'audio';
    this.callParticipants = new Map(); // userId -> participant info
    this.iceConfig = null; // Will be fetched from server
    this.pendingOffers = []; // Offers waiting for real call ID
    this.callIdResolve = null; // Promise resolver for call ID
    this.localStream = null; // Local media stream for calls
  }

  async getICEConfig() {
    if (this.iceConfig) return this.iceConfig;
    
    try {
      console.log('Fetching ICE config from /calls/ice-config');
      const response = await apiRequest('/calls/ice-config');
      console.log('ICE config response:', response);
      console.log('ICE config response status:', response.status);
      console.log('ICE config response headers:', [...response.headers.entries()]);
      if (response.ok) {
        this.iceConfig = await response.json();
        console.log('ICE config:', this.iceConfig);
      } else {
        const errorText = await response.text();
        console.error('ICE config request failed:', response.status, response.statusText, errorText);
      }
    } catch (err) {
      console.error('Failed to fetch ICE config:', err);
    }
    
    // Return default if fetch failed
    return this.iceConfig || {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  /**
   * Wait for the real call ID to be assigned by the server
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<string>} - The real call ID
   */
  waitForCallId(timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (this.activeCall && this.activeCall.id && !this.activeCall.id.startsWith('temp-')) {
        resolve(this.activeCall.id);
        return;
      }
      
      // Set up timeout that will reject if call ID doesn't arrive in time
      const timer = setTimeout(() => {
        // Only reject if this promise's resolver is still active
        if (this.callIdResolve === wrappedResolve) {
          this.callIdResolve = null;
          reject(new Error('Timeout waiting for call ID from server'));
        }
      }, timeout);
      
      // Wrap resolve to clear timeout and properly handle cleanup
      const wrappedResolve = (callId) => {
        clearTimeout(timer);
        this.callIdResolve = null;
        resolve(callId);
      };
      
      this.callIdResolve = wrappedResolve;
    });
  }

  async startCall(participantIds, callType = 'audio', externalStream = null) {
    this.callType = callType;

    // Send call_start to participants via WebSocket (server will create the call)
    // Generate a temporary call ID for tracking
    const tempCallId = 'temp-' + crypto.randomUUID();
    this.activeCall = {
      id: tempCallId,
      type: callType,
      participants: participantIds,
      callerId: this.userId
    };

    // Send call_start to participants - server will create the call and return the real ID
    this.ws.send(JSON.stringify({
      type: 'call_start',
      call_type: callType,
      participants: participantIds,
      caller_id: this.userId
    }));

    // Get ICE config from server
    const iceConfig = await this.getICEConfig();

    // Create peer connections for each participant
    for (const pid of participantIds) {
      const pc = new PeerConnection(pid, callType, iceConfig);
      await pc.createPeerConnection();

      // Use external stream if provided, otherwise get local stream
      // Note: getLocalStream() already adds tracks to the connection internally
      // so we only need to add tracks for external streams
      if (externalStream) {
        console.log('[DEBUG] startCall: Using external stream, tracks:', externalStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
        // Add tracks from external stream to peer connection
        externalStream.getTracks().forEach(track => {
          console.log('[DEBUG] startCall: Adding track to connection:', track.kind, track.id);
          pc.connection.addTrack(track, externalStream);
        });
        // Store the local stream for use in handleOffer
        this.localStream = externalStream;
        console.log('[DEBUG] startCall: Stored external stream as localStream');
       } else {
         try {
           // getLocalStream() will add tracks to the connection internally
           const stream = await pc.getLocalStream();
           // Store the local stream for use in handleOffer
           this.localStream = stream;
         } catch (err) {
          console.error('Failed to get local stream:', err);
          // Notify user that their media is unavailable
          window.dispatchEvent(new CustomEvent('mediaError', {
            detail: {
              userId: pid,
              error: err.message,
              callType: callType
            }
          }));
          // Continue without local stream - call will be one-way
        }
      }

      this.peerConnections.set(pid, pc);

      // Handle ICE candidate
      pc.connection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendIceCandidate(pid, event.candidate);
        }
      };

      // Handle remote stream
      pc.connection.ontrack = (event) => {
        console.log('[DEBUG] startCall: ontrack event received, track:', event.track.kind, 'streams:', event.streams.length);
        window.dispatchEvent(new CustomEvent('remoteStream', {
          detail: { userId: pid, stream: event.streams[0] }
        }));
      };
      
      // Log connection state changes
      pc.connection.onconnectionstatechange = () => {
        console.log('[DEBUG] startCall: Connection state changed to:', pc.connection.connectionState);
      };
      
      pc.connection.oniceconnectionstatechange = () => {
        console.log('[DEBUG] startCall: ICE connection state changed to:', pc.connection.iceConnectionState);
      };
    }

    // Create offers for all participants
    const offers = [];
    for (const pid of participantIds) {
      const pc = this.peerConnections.get(pid);
      const offer = await pc.createOffer();
      console.log('[DEBUG] startCall: Created offer for', pid, 'SDP contains audio:', offer.sdp.includes('m=audio'), 'video:', offer.sdp.includes('m=video'));
      console.log('[DEBUG] startCall: Offer SDP (first 500 chars):', offer.sdp.substring(0, 500));
      offers.push({ participantId: pid, offer });
    }

    // Wait for real call ID from server before sending offers
    try {
      await this.waitForCallId();
    } catch (err) {
      console.error('Failed to get call ID from server:', err);
      // Clean up and fail the call - cannot proceed without valid call ID
      this.closeAllPeerConnections();
      this.activeCall = null;
      throw new Error('Failed to establish call - server did not respond. Please try again.');
    }

    // Send offers with the real call ID
    for (const { participantId, offer } of offers) {
      this.sendOffer(participantId, offer);
    }

    return this.activeCall;
  }

  async joinCall(callId) {
    this.activeCall = {
      id: callId,
      type: this.callType,
      participants: [],
      callerId: null
    };

    // Send call_join to server via WebSocket (server handles both signaling and persistence)
    this.ws.send(JSON.stringify({
      type: 'call_join',
      call_id: callId,
      user_id: this.userId
    }));
  }

  async leaveCall() {
    if (!this.activeCall) return;

    const callId = this.activeCall.id;

    // Send call_leave to server via WebSocket (server handles both signaling and persistence)
    this.ws.send(JSON.stringify({
      type: 'call_leave',
      call_id: callId,
      user_id: this.userId
    }));

    // Close all peer connections
    this.closeAllPeerConnections();

    this.activeCall = null;
  }

  async endCall() {
    if (!this.activeCall) return;

    const callId = this.activeCall.id;

    // Send call_end to server via WebSocket (server handles both signaling and persistence)
    this.ws.send(JSON.stringify({
      type: 'call_end',
      call_id: callId,
      user_id: this.userId
    }));

    // Close all peer connections
    this.closeAllPeerConnections();

    this.activeCall = null;
  }

  async rejectCall(callId) {
    // Send call_reject to server via WebSocket (server handles both signaling and persistence)
    this.ws.send(JSON.stringify({
      type: 'call_reject',
      call_id: callId,
      user_id: this.userId
    }));
  }

  async sendOffer(participantId, offer) {
    if (!this.activeCall) {
      console.error('No active call when sending offer');
      return;
    }
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, cannot send offer');
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'call_offer',
      call_id: this.activeCall.id,
      caller_id: this.userId,
      target_user_id: participantId,  // Specify the intended recipient
      sdp: offer.sdp,
      call_type: this.callType
    }));
  }

  async sendAnswer(participantId, answer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, cannot send answer');
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'call_answer',
      call_id: this.activeCall.id,
      callee_id: this.userId,
      sdp: answer.sdp
    }));
  }

  sendIceCandidate(participantId, candidate) {
    console.log('[WebRTC] sendIceCandidate: Sending ICE candidate to', participantId);
    if (!this.activeCall) {
      console.error('[WebRTC] sendIceCandidate: No active call when sending ICE candidate');
      return;
    }
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[WebRTC] sendIceCandidate: WebSocket not connected, cannot send ICE candidate');
      return;
    }
    
    // Convert RTCIceCandidate to JSON-serializable object
    // The candidate from onicecandidate event may be an RTCIceCandidate object
    // which doesn't serialize properly with JSON.stringify
    const candidateData = candidate.toJSON ? candidate.toJSON() : {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    };
    
    // Log candidate type for debugging (host, srflx, relay)
    const candidateType = candidateData.candidate?.split(' ')[7] || 'unknown';
    console.log('[WebRTC] sendIceCandidate: Candidate type:', candidateType, 'data:', candidateData.candidate?.substring(0, 80) + '...');
    
    this.ws.send(JSON.stringify({
      type: 'call_ice_candidate',
      call_id: this.activeCall.id,
      user_id: this.userId,
      target_user_id: participantId,  // The peer who should receive this ICE candidate
      candidate: candidateData
    }));
  }

  closeAllPeerConnections() {
    for (const [userId, pc] of this.peerConnections) {
      pc.close();
    }
    this.peerConnections.clear();
  }

  async handleOffer(data) {
    const { call_id, caller_id, sdp, call_type } = data;
    this.callType = call_type;

    // Store the call ID for this incoming call
    this.activeCall = {
      id: call_id,
      type: call_type,
      participants: [],
      callerId: caller_id
    };

    // Get ICE config from server
    const iceConfig = await this.getICEConfig();

     // Create peer connection for caller
     const pc = new PeerConnection(caller_id, call_type, iceConfig);
     await pc.createPeerConnection();
     this.peerConnections.set(caller_id, pc);

     // Use stored local stream if available, otherwise get a new one
     // This ensures we use the same stream that was obtained in acceptCall()
     console.log('[DEBUG] handleOffer: localStream exists?', !!this.localStream);
     if (this.localStream) {
       console.log('[DEBUG] handleOffer: Using stored local stream, tracks:', this.localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
       // Add tracks from stored stream to the connection
       this.localStream.getTracks().forEach(track => {
         console.log('[DEBUG] handleOffer: Adding track to connection:', track.kind, track.id);
         pc.connection.addTrack(track, this.localStream);
       });
       console.log('Using stored local stream for answer');
     } else {
       try {
         // getLocalStream() will add tracks to the connection internally
         const stream = await pc.getLocalStream();
         // Store the local stream for future use
         this.localStream = stream;
        } catch (err) {
          console.error('Failed to get local stream for answer:', err);
          // Notify user that their media is unavailable
          window.dispatchEvent(new CustomEvent('mediaError', {
            detail: { 
              userId: caller_id, 
              error: err.message,
              callType: call_type
            }
          }));
          // Continue without local stream - call will be one-way
        }
      }

    // Set remote description from offer
    try {
      console.log('Setting remote description with offer:', { type: 'offer', sdp: typeof sdp === 'string' ? sdp.substring(0, 100) + '...' : sdp });
      console.log('SDP type:', typeof sdp, 'SDP value:', sdp);
      await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
      console.log('Remote description set successfully, connection state:', pc.connection.connectionState);
    } catch (err) {
      console.error('Failed to set remote description in handleOffer:', err);
      // Notify user about the error
      window.dispatchEvent(new CustomEvent('mediaError', {
        detail: { 
          userId: caller_id, 
          error: 'Failed to establish call - invalid SDP received',
          callType: call_type
        }
      }));
      // Clean up
      this.peerConnections.delete(caller_id);
      return;
    }

    // Handle ICE candidates - MUST be set up BEFORE setLocalDescription
    // to catch early ICE candidates
    pc.connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIceCandidate(caller_id, event.candidate);
      }
    };

    // Handle remote stream
    pc.connection.ontrack = (event) => {
      console.log('[DEBUG] handleOffer: ontrack event received, track:', event.track.kind, 'streams:', event.streams.length);
      window.dispatchEvent(new CustomEvent('remoteStream', {
        detail: { userId: caller_id, stream: event.streams[0] }
      }));
    };
    
    // Log connection state changes
    pc.connection.onconnectionstatechange = () => {
      console.log('[DEBUG] handleOffer: Connection state changed to:', pc.connection.connectionState);
    };
    
    pc.connection.oniceconnectionstatechange = () => {
      console.log('[DEBUG] handleOffer: ICE connection state changed to:', pc.connection.iceConnectionState);
    };

    // Create answer
    console.log('Creating answer, connection state:', pc.connection.connectionState);
    const answer = await pc.createAnswer();
    console.log('[DEBUG] handleOffer: Answer created, SDP contains audio:', answer.sdp.includes('m=audio'), 'video:', answer.sdp.includes('m=video'));
    console.log('[DEBUG] handleOffer: Answer SDP (first 500 chars):', answer.sdp.substring(0, 500));
    // Note: createAnswer() already calls setLocalDescription internally

    // Send answer to caller
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, cannot send answer');
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'call_answer',
      call_id: call_id,
      callee_id: this.userId,
      sdp: answer.sdp
    }));
  }

  async handleAnswer(data) {
    const { call_id, callee_id, sdp } = data;
    console.log('[DEBUG] handleAnswer: Received answer from', callee_id, 'SDP contains audio:', sdp.includes('m=audio'), 'video:', sdp.includes('m=video'));

    const pc = this.peerConnections.get(callee_id);
    if (pc) {
      console.log('[DEBUG] handleAnswer: Setting remote description, current state:', pc.connection.connectionState);
      await pc.setRemoteDescription({ type: 'answer', sdp: sdp });
      console.log('[DEBUG] handleAnswer: Remote description set, new state:', pc.connection.connectionState);
    } else {
      console.error('[DEBUG] handleAnswer: No peer connection found for', callee_id);
    }
  }

  async handleIceCandidate(data) {
    const { call_id, user_id: senderUserId, candidate } = data;
    console.log('[WebRTC] handleIceCandidate: Received ICE candidate from', senderUserId, 'type:', candidate?.candidate?.split(' ')[7] || 'unknown');

    // Look up peer connection by the sender's user ID
    const pc = this.peerConnections.get(senderUserId);
    if (pc) {
      console.log('[WebRTC] handleIceCandidate: Adding ICE candidate, current ICE state:', pc.connection.iceConnectionState);
      try {
        await pc.addIceCandidate(candidate);
        console.log('[WebRTC] handleIceCandidate: ICE candidate added successfully');
      } catch (err) {
        console.error('[WebRTC] handleIceCandidate: Failed to add ICE candidate:', err);
      }
    } else {
      console.error('[WebRTC] handleIceCandidate: No peer connection found for', senderUserId);
    }
  }

  handleCallState(data) {
    // Handle call state updates
    console.log('Call state update:', data);
  }

  /**
   * Handle call_start message - update active call with real call ID
   * This is called when the server responds with the real call ID
   */
  handleCallStart(data) {
    const { call_id, caller_id, call_type, participants } = data;
    
    // If we're the caller, update our active call with the real call ID
    if (this.activeCall && caller_id === this.userId) {
      this.activeCall.id = call_id;
      
      // Resolve the promise if someone is waiting for the call ID
      if (this.callIdResolve) {
        this.callIdResolve(call_id);
        this.callIdResolve = null;
      }
    }
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('callStart', {
      detail: { callId: call_id, callerId: caller_id, callType: call_type, participants }
    }));
  }
}
