//! The RAM side of admission: a fixed number of running slots and a priority heap of waiters.
//!
//! Module map (caller-first):
//!   Gate::enter      take a slot now, queue in the heap, or report Full (may spill)
//!   Gate::acquire    wait for a slot regardless of heap depth (spool workers)
//!   Gate::load       running slots and waiting requests, for /health
//!   Permit::drop     hands the slot to the highest-priority waiter, or frees it
//!   Waiter ordering  lowest class first, then earliest arrival
use std::{
    cmp::Ordering,
    collections::BinaryHeap,
    sync::{Arc, Mutex, MutexGuard},
};
use tokio::sync::oneshot;

pub struct Gate {
    state: Mutex<GateState>,
    max_inflight: usize,
    ram_queue_depth: usize,
}

#[derive(Default)]
struct GateState {
    active: usize,
    heap: BinaryHeap<Waiter>,
    seq: u64,
}

struct Waiter {
    priority: u8,
    seq: u64,
    tx: oneshot::Sender<Permit>,
}

/// One running slot. Dropping it hands the slot to the highest-priority waiter.
pub struct Permit {
    gate: Arc<Gate>,
}

pub enum Admit {
    Now(Permit),
    Wait(oneshot::Receiver<Permit>),
    Full,
}

impl Gate {
    pub fn new(max_inflight: usize, ram_queue_depth: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::default(),
            max_inflight,
            ram_queue_depth,
        })
    }

    /// Mental model: a free slot is taken at once; otherwise the request joins the heap, unless
    /// it may spill and the heap is already at its depth.
    pub fn enter(self: &Arc<Self>, priority: u8, may_spill: bool) -> Admit {
        let mut state = self.lock();
        if state.active < self.max_inflight {
            state.active += 1;
            return Admit::Now(Permit { gate: self.clone() });
        }
        if may_spill && self.is_heap_full(&state) {
            return Admit::Full;
        }
        Admit::Wait(Self::join_heap(&mut state, priority))
    }

    pub async fn acquire(self: &Arc<Self>, priority: u8) -> Option<Permit> {
        match self.enter(priority, false) {
            Admit::Now(permit) => Some(permit),
            Admit::Wait(rx) => rx.await.ok(),
            Admit::Full => None,
        }
    }

    pub fn load(&self) -> (usize, usize) {
        let state = self.lock();
        (state.active, state.heap.len())
    }

    fn join_heap(state: &mut GateState, priority: u8) -> oneshot::Receiver<Permit> {
        let (tx, rx) = oneshot::channel();
        state.seq += 1;
        let seq = state.seq;
        state.heap.push(Waiter { priority, seq, tx });
        rx
    }

    #[inline]
    fn is_heap_full(&self, state: &GateState) -> bool {
        state.heap.len() >= self.ram_queue_depth
    }

    // A poisoned lock still holds consistent counters; keep serving.
    #[inline]
    fn lock(&self) -> MutexGuard<'_, GateState> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

impl Drop for Permit {
    /// Mental model: the slot is never released while someone waits — it moves straight to the
    /// best waiter; only an empty heap gives the slot back.
    fn drop(&mut self) {
        loop {
            let mut state = self.gate.lock();
            let Some(waiter) = state.heap.pop() else {
                state.active = state.active.saturating_sub(1);
                return;
            };
            drop(state);
            match waiter.tx.send(Permit {
                gate: self.gate.clone(),
            }) {
                Ok(()) => return,
                // The waiter left (client disconnected); pass the slot on without releasing it.
                Err(orphan) => std::mem::forget(orphan),
            }
        }
    }
}

impl PartialEq for Waiter {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq
    }
}
impl Eq for Waiter {}
impl PartialOrd for Waiter {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Waiter {
    // BinaryHeap pops the greatest: lowest priority number, then earliest arrival.
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .priority
            .cmp(&self.priority)
            .then(other.seq.cmp(&self.seq))
    }
}
