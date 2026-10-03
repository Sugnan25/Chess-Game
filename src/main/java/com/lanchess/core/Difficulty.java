package com.lanchess.core;

/**
 * The three strengths the computer opponent can play at.
 *
 * <p>Each level differs by how deep it searches, how much noise it adds to its
 * evaluation, and how often it deliberately picks a weaker move. That produces
 * a beginner who hangs pieces, a club player, and an opponent that punishes
 * loose play, without needing three different search implementations.
 */
public enum Difficulty {

    /** Shallow and a little random, so it misses tactics a human would see. */
    SIMPLE("Simple", "Just learning the moves", 1, 120, 30, 25, 2000),

    /** A solid club-level opponent that still misses the deepest ideas. */
    MEDIUM("Medium", "Plays a steady game", 3, 700, 8, 6, 2400),

    /** Deep search with full quiescence and no deliberate mistakes. */
    HARD("Hard", "Will punish a loose move", 6, 2600, 0, 0, 2800);

    private final String label;
    private final String blurb;
    private final int maxDepth;
    private final long budgetMillis;
    private final int blunderChance;
    private final int noise;
    private final long minimumThinkMillis;

    Difficulty(String label, String blurb, int maxDepth, long budgetMillis, int blunderChance, int noise,
            long minimumThinkMillis) {
        this.label = label;
        this.blurb = blurb;
        this.maxDepth = maxDepth;
        this.budgetMillis = budgetMillis;
        this.blunderChance = blunderChance;
        this.noise = noise;
        this.minimumThinkMillis = minimumThinkMillis;
    }

    public String label() {
        return this.label;
    }

    public String blurb() {
        return this.blurb;
    }

    /** Deepest the search will go, in full moves. */
    public int maxDepth() {
        return this.maxDepth;
    }

    /** Soft wall-clock budget for one move. */
    public long budgetMillis() {
        return this.budgetMillis;
    }

    /**
     * How long the computer takes over a move whatever the search cost.
     *
     * <p>A budget is a ceiling, not a floor, so a depth 1 level answers in
     * milliseconds and the reply snaps out. Waiting out this floor is what
     * makes every level feel like it is considering the position.
     */
    public long minimumThinkMillis() {
        return this.minimumThinkMillis;
    }

    /** Percentage chance of deliberately choosing a weaker move. */
    public int blunderChance() {
        return this.blunderChance;
    }

    /** Centipawns of random error added to each move's score. */
    public int noise() {
        return this.noise;
    }

    public static Difficulty of(String name) {
        if (name != null) {
            for (Difficulty d : values()) {
                if (d.name().equalsIgnoreCase(name)) {
                    return d;
                }
            }
        }
        return MEDIUM;
    }
}
