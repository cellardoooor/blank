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
  }

  async getICEConfig() {
    if (this.iceConfig) return this.iceConfig;
    
    try {
      const response = await apiRequest('/calls/ice-config');
      if (response.ok) {
        this.iceConfig = await response.json();
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
        // Add tracks from external stream to peer connection
        externalStream.getTracks().forEach(track => {
          pc.connection.addTrack(track, externalStream);
        });
      } else {
        try {
          // getLocalStream() will add tracks to the connection internally
          await pc.getLocalStream();
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
        window.dispatchEvent(new CustomEvent('remoteStream', {
          detail: { userId: pid, stream: event.streams[0] }
        }));
      };
    }

    // Create offers for all participants
    const offers = [];
    for (const pid of participantIds) {
      const pc = this.peerConnections.get(pid);
      const offer = await pc.createOffer();
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
    if (!this.activeCall) {
      console.error('No active call when sending ICE candidate');
      return;
    }
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, cannot send ICE candidate');
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

    // Get local stream (tracks are added to connection inside getLocalStream)
    try {
      await pc.getLocalStream();
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

    // Set remote description from offer
    try {
      console.log('Setting remote description with offer:', { type: 'offer', sdp: sdp.substring(0, 100) + '...' });
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
      window.dispatchEvent(new CustomEvent('remoteStream', {
        detail: { userId: caller_id, stream: event.streams[0] }
      }));
    };

    // Create answer
    console.log('Creating answer, connection state:', pc.connection.connectionState);
    const answer = await pc.createAnswer();
    console.log('Answer created:', answer);

    // Set local description (MUST await - ICE candidates are generated after this)
    // This is critical: ICE candidates are only generated after setLocalDescription completes
    await pc.connection.setLocalDescription(answer);

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

    const pc = this.peerConnections.get(callee_id);
    if (pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: sdp });
    }
  }

  async handleIceCandidate(data) {
    const { call_id, user_id: senderUserId, candidate } = data;

    // Look up peer connection by the sender's user ID
    const pc = this.peerConnections.get(senderUserId);
    if (pc) {
      await pc.addIceCandidate(candidate);
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
