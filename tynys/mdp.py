"""Finite-horizon MDP: go now, wait an hour, or skip (SPEC 4.4).

State (t, s): hour index t = 0..H and air class s.
Actions: go (terminal), skip (terminal, reward 0), wait (only for t < H).
Solved by backward induction (finite-horizon value iteration with the Bellman equation).
"""

from tynys.hmm import emission_matrix, normalise

# Floating-point slack on the 50 % threshold: a cumulative sum such as 0.3 + 0.2 can come out as
# 0.49999999999999994 and must still count as reaching one half.
HALF_TOLERANCE = 1e-12

ACTIONS = ["go", "wait", "skip"]  # also the tie-breaking order: go, then wait, then skip


def reward_go(benefit, harm, duration_min, intensity, sensitivity):
    """R_go(s) = benefit - harm[s] * (duration_min / 60) * intensity * sensitivity, for every class s."""
    hours = duration_min / 60
    return [benefit - harm[s] * hours * intensity * sensitivity for s in range(len(harm))]


def waiting_transition(transition, r_next, forecast_band_next):
    """Dynamics while waiting one hour, by Bayes' rule with the next forecast:

    T[s][s'] = A[s][s'] * B(r_next)[s'][f_next] / (sum over s'' of the same)
             = P(s_{t+1} = s' | s_t = s, next forecast band f_next)
    """
    emission = emission_matrix(r_next, len(transition))
    matrix = []
    for s in range(len(transition)):
        row = [transition[s][s2] * emission[s2][forecast_band_next] for s2 in range(len(transition))]
        matrix.append(normalise(row)[0])
    return matrix


def best_action(q_go, q_wait, q_skip):
    """Pick the action with the highest Q; ties prefer go, then wait, then skip. None means not allowed."""
    best = None
    best_value = None
    for action, value in (("go", q_go), ("wait", q_wait), ("skip", q_skip)):
        if value is None:
            continue
        if best is None or value > best_value:
            best = action
            best_value = value
    return best, best_value


def backward_induction(rewards_go, transitions, wait_cost, must):
    """Solve the MDP backwards from the deadline t = H to now t = 0.

    H = len(transitions); transitions[t] is T_t (used when waiting at hour t).
    Q_t(s, go)   = R_go(s)
    Q_t(s, skip) = 0                      (not allowed for a `must` activity)
    Q_t(s, wait) = -wait_cost + sum_s' T_t[s][s'] * V_{t+1}(s')     for t < H
    V_t(s)       = max over the allowed actions
    Returns one dict per hour t: {"q_go", "q_wait" (None at t = H), "q_skip", "value", "policy"}.
    """
    horizon = len(transitions)
    n = len(rewards_go)
    stages = [None] * (horizon + 1)
    next_value = None
    for t in range(horizon, -1, -1):
        q_go = list(rewards_go)
        q_skip = None if must else 0.0
        q_wait = None
        if t < horizon:
            q_wait = []
            for s in range(n):
                expected_next = sum(transitions[t][s][s2] * next_value[s2] for s2 in range(n))
                q_wait.append(-wait_cost + expected_next)
        value = []
        policy = []
        for s in range(n):
            action, v = best_action(q_go[s], None if q_wait is None else q_wait[s], q_skip)
            value.append(v)
            policy.append(action)
        stages[t] = {"q_go": q_go, "q_wait": q_wait, "q_skip": q_skip, "value": value, "policy": policy}
        next_value = value
    return stages


def qmdp_decision(belief, stage0):
    """Action now under uncertainty (QMDP): Q(b, a) = sum_s belief[s] * Q_0(s, a), take the best a.

    Returns (action, q_go, q_wait, q_skip) with the belief-weighted values (q_skip None if not allowed).
    """
    n = len(belief)
    q_go = sum(belief[s] * stage0["q_go"][s] for s in range(n))
    q_wait = None
    if stage0["q_wait"] is not None:
        q_wait = sum(belief[s] * stage0["q_wait"][s] for s in range(n))
    q_skip = stage0["q_skip"]
    action, _ = best_action(q_go, q_wait, q_skip)
    return action, q_go, q_wait, q_skip


def go_probabilities(belief, action_now, stages, transitions):
    """When will I probably go? Push the class distribution forward under the policy.

    go now:  p_go[0] = 1.        skip now: p_skip = 1.
    wait:    d_1[s'] = sum_s belief[s] * T_0[s][s'], then for t >= 1
             p_go[t]   = sum of d_t[s] over classes whose policy is go
             p_skip   += sum of d_t[s] over classes whose policy is skip
             d_{t+1}[s'] = sum over classes s whose policy is wait of d_t[s] * T_t[s][s']
    Returns (p_go list for t = 0..H, p_skip).
    """
    horizon = len(transitions)
    n = len(belief)
    p_go = [0.0] * (horizon + 1)
    p_skip = 0.0
    if action_now == "go":
        p_go[0] = 1.0
        return p_go, p_skip
    if action_now == "skip":
        return p_go, 1.0
    d = [sum(belief[s] * transitions[0][s][s2] for s in range(n)) for s2 in range(n)]
    for t in range(1, horizon + 1):
        policy = stages[t]["policy"]
        next_d = [0.0] * n
        for s in range(n):
            if policy[s] == "go":
                p_go[t] += d[s]
            elif policy[s] == "skip":
                p_skip += d[s]
            else:  # wait (never chosen at t = H)
                for s2 in range(n):
                    next_d[s2] += d[s] * transitions[t][s][s2]
        d = next_d
    return p_go, p_skip


def median_go_hour(p_go):
    """best_t = the first hour where the cumulative p_go reaches 0.5; None if it never does."""
    cumulative = 0.0
    for t, p in enumerate(p_go):
        cumulative += p
        if cumulative >= 0.5 - HALF_TOLERANCE:
            return t
    return None
