"""Hidden Markov model over hourly PM2.5 classes (SPEC 4.2-4.3).

Hidden state  = the true air class where the person is (0 low .. 3 high).
Observation   = the band of the model reading for the city grid cell.

The functions work for any number of states, so the tests can run them on the
AIMA umbrella world (2 states, 2 observations) as well.
Matrices are plain lists of lists: matrix[i][j] is row i, column j.
"""

import math

from tynys.classes import BLOCKS, DEFAULT_REP_PM25, N_CLASSES, band, block_of_hour


# ---------------------------------------------------------------- small helpers

def normalise(vector):
    """Return (vector / sum(vector), sum(vector)). The sum is the Bayes evidence when vector is unnormalised."""
    total = sum(vector)
    if total == 0:
        raise ValueError("cannot normalise a zero vector (impossible observation)")
    return [x / total for x in vector], total


def argmax(vector):
    """Index of the largest entry (the first one on ties)."""
    best = 0
    for i in range(1, len(vector)):
        if vector[i] > vector[best]:
            best = i
    return best


def log0(x):
    """log(x), with log(0) = -inf so zero-probability emissions are allowed in Viterbi."""
    if x == 0:
        return -math.inf
    return math.log(x)


# ---------------------------------------------------------------- model parameters

def emission_matrix(r, n=N_CLASSES):
    """Emission B(r)[i][j] = P(reading band j | true class i).

    r on the diagonal; the remaining 1 - r split equally between the adjacent bands
    (an edge class gives all of it to its single neighbour); zero elsewhere.
    """
    matrix = []
    for i in range(n):
        row = [0.0] * n
        row[i] = r
        neighbours = [j for j in (i - 1, i + 1) if 0 <= j < n]
        for j in neighbours:
            row[j] = (1 - r) / len(neighbours)
        matrix.append(row)
    return matrix


def forecast_reliability(k):
    """Trust in the forecast k hours ahead: r_f(k) = max(0.5, 0.75 - 0.005 * k)."""
    return max(0.5, 0.75 - 0.005 * k)


def prior_from_bands(bands, n=N_CLASSES):
    """Prior pi[s] = (number of hours in band s + 1) / (number of hours + n)  (add-one smoothing)."""
    counts = [0] * n
    for b in bands:
        if b is not None:
            counts[b] += 1
    total = sum(counts)
    return [(counts[s] + 1) / (total + n) for s in range(n)]


def count_transitions(bands, hours, n=N_CLASSES):
    """Count hour -> next-hour band pairs N_b[i][j], split by the time-of-day block b of the origin hour.

    bands[t] is the band of reading t (None when missing), hours[t] its local clock hour.
    Readings must be consecutive hours. Returns {"night": N, "morning": N, "day": N, "evening": N, "all": N}.
    """
    counts = {name: [[0] * n for _ in range(n)] for name in BLOCKS + ["all"]}
    for t in range(len(bands) - 1):
        i, j = bands[t], bands[t + 1]
        if i is None or j is None:
            continue
        counts[block_of_hour(hours[t])][i][j] += 1
        counts["all"][i][j] += 1
    return counts


def smoothed_row(count_row):
    """Add-one smoothing of one count row: A[i][j] = (N[i][j] + 1) / (sum_j N[i][j] + n)."""
    total = sum(count_row)
    n = len(count_row)
    return [(c + 1) / (total + n) for c in count_row]


def transition_matrices(counts, min_count=20):
    """Smoothed transition matrix A_b per block, with back-off for sparse rows.

    If row i of block b has fewer than min_count counted transitions, row i of the pooled
    "all" counts is used instead (smoothed the same way). Returns (matrices, backed_off) where
    backed_off lists {"block", "row", "count"} for every row that backed off.
    """
    matrices = {}
    backed_off = []
    for block in BLOCKS:
        matrix = []
        for i, row in enumerate(counts[block]):
            if sum(row) < min_count:
                backed_off.append({"block": block, "row": i, "count": sum(row)})
                matrix.append(smoothed_row(counts["all"][i]))
            else:
                matrix.append(smoothed_row(row))
        matrices[block] = matrix
    return matrices, backed_off


def representative_pm25(pm_values):
    """rep[s] = median PM2.5 of the history hours in band s; the default [2.5, 10, 20, 35][s] if fewer than 5."""
    groups = [[] for _ in range(N_CLASSES)]
    for pm in pm_values:
        groups[band(pm)].append(pm)
    rep = []
    for s in range(N_CLASSES):
        values = sorted(groups[s])
        if len(values) < 5:
            rep.append(DEFAULT_REP_PM25[s])
        else:
            middle = len(values) // 2
            if len(values) % 2 == 1:
                rep.append(values[middle])
            else:
                rep.append((values[middle - 1] + values[middle]) / 2)
    return rep


# ---------------------------------------------------------------- filtering (forward algorithm)

def predict_step(belief, transition):
    """One time step without evidence: p[j] = sum_i transition[i][j] * belief[i]   (p = A^T belief)."""
    n = len(belief)
    return [sum(transition[i][j] * belief[i] for i in range(n)) for j in range(n)]


def bayes_update(predicted, emission, obs):
    """Bayes' rule for one reading: posterior[s] = B[s][obs] * predicted[s] / evidence.

    Returns every intermediate so it can be shown: predicted prior, likelihood column,
    unnormalised product, evidence (the normaliser) and posterior.
    """
    likelihood = [emission[s][obs] for s in range(len(predicted))]
    unnormalised = [likelihood[s] * predicted[s] for s in range(len(predicted))]
    posterior, evidence = normalise(unnormalised)
    return {"predicted": predicted, "likelihood": likelihood, "unnormalised": unnormalised,
            "evidence": evidence, "posterior": posterior}


def forward(observations, prior, transitions, emission):
    """Forward filter (Bayes filtering).

    alpha_1 = normalise(pi * B[:, o_1])
    alpha_t = normalise(B[:, o_t] * (A_{t-1}^T alpha_{t-1}))
    transitions[t] is the matrix that moves step t to step t+1 (0-based). Returns the list of beliefs alpha_t.
    A missing reading (None) gives no evidence: alpha_t is then just the predicted belief.
    """
    beliefs = []
    for t in range(len(observations)):
        predicted = prior if t == 0 else predict_step(beliefs[-1], transitions[t - 1])
        if observations[t] is None:
            beliefs.append(predicted)
        else:
            beliefs.append(bayes_update(predicted, emission, observations[t])["posterior"])
    return beliefs


def viterbi(observations, prior, transitions, emission):
    """Most likely hidden sequence, computed in log space.

    score_1[s] = log pi[s] + log B[s][o_1]
    score_t[s] = max_i (score_{t-1}[i] + log A_{t-1}[i][s]) + log B[s][o_t]
    then follow the back-pointers from the best final state. log0(0) = -inf.
    A missing reading (None) contributes log 1 = 0 for every state.
    """
    n = len(prior)

    def log_emission(s, obs):
        return 0.0 if obs is None else log0(emission[s][obs])

    score = [log0(prior[s]) + log_emission(s, observations[0]) for s in range(n)]
    back = []
    for t in range(1, len(observations)):
        transition = transitions[t - 1]
        new_score = []
        pointers = []
        for s in range(n):
            best_i = 0
            best_value = -math.inf
            for i in range(n):
                value = score[i] + log0(transition[i][s])
                if value > best_value:
                    best_value = value
                    best_i = i
            new_score.append(best_value + log_emission(s, observations[t]))
            pointers.append(best_i)
        score = new_score
        back.append(pointers)
    state = argmax(score)
    path = [state]
    for pointers in reversed(back):
        state = pointers[state]
        path.append(state)
    path.reverse()
    return path


# ---------------------------------------------------------------- prediction with the forecast

def predict_ahead(belief_now, transitions, forecast_bands, n=N_CLASSES):
    """Belief for future hours k = 1..K, using the forecast as a weaker reading.

    p_k      = A_{k-1}^T belief_{k-1}
    belief_k = normalise(B(r_f(k))[:, f_k] * p_k),  belief_0 = belief_now
    transitions[k-1] is the matrix for the block of hour k-1; forecast_bands[k-1] is f_k.
    Returns a list of {"lead_h", "forecast_band", "forecast_reliability", "belief"}.
    """
    out = []
    belief = belief_now
    for k in range(1, len(forecast_bands) + 1):
        r_f = forecast_reliability(k)
        predicted = predict_step(belief, transitions[k - 1])
        belief = bayes_update(predicted, emission_matrix(r_f, n), forecast_bands[k - 1])["posterior"]
        out.append({"lead_h": k, "forecast_band": forecast_bands[k - 1],
                    "forecast_reliability": r_f, "belief": belief})
    return out


def expected_pm25(belief, rep):
    """E[pm] = sum_s belief[s] * rep[s]."""
    return sum(belief[s] * rep[s] for s in range(len(belief)))


# ---------------------------------------------------------------- fitting from a history

def fit(bands, hours, min_count=20):
    """Learn prior, transition counts and matrices from consecutive history hours.

    Returns {"prior", "counts", "transitions", "backed_off"}.
    """
    counts = count_transitions(bands, hours)
    transitions, backed_off = transition_matrices(counts, min_count)
    return {"prior": prior_from_bands(bands), "counts": counts,
            "transitions": transitions, "backed_off": backed_off}


def transitions_between(matrices, hours):
    """Transition matrices for the steps between consecutive hours of a list.

    hours = [h_0, h_1, ..., h_n] are consecutive clock hours. The step h_i -> h_(i+1) uses the matrix of
    the time-of-day block of its ORIGIN hour h_i, so the result has n matrices (one fewer than hours):
        [A_block(h_0), A_block(h_1), ..., A_block(h_(n-1))]
    The filter, Viterbi, the prediction and the MDP all use this one convention.
    """
    steps = []
    for i in range(len(hours) - 1):
        steps.append(matrices[block_of_hour(hours[i])])
    return steps
