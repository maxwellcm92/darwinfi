import { FrontierManager } from '../../src/agent/frontier-manager';
import { PerformanceTracker } from '../../src/agent/performance';
import { expect } from 'chai';

describe('FrontierManager', () => {
  let manager: FrontierManager;
  let tracker: PerformanceTracker;

  beforeEach(() => {
    tracker = new PerformanceTracker();
    manager = new FrontierManager(tracker);
    manager.initialize();
  });

  // ---------- Initialization ----------

  describe('Initialization', () => {
    it('should create exactly 4 bots', () => {
      const bots = manager.getAllBots();
      expect(bots).to.have.length(4);
    });

    it('should create one bot per archetype', () => {
      const archetypes = manager.getAllBots().map(b => b.archetype);
      expect(archetypes).to.include('abiogenesis');
      expect(archetypes).to.include('mitosis');
      expect(archetypes).to.include('cambrian');
      expect(archetypes).to.include('symbiont');
    });

    it('should initialize performance tracking for each bot', () => {
      for (const bot of manager.getAllBots()) {
        const metrics = tracker.getMetrics(bot.id);
        expect(metrics).to.exist;
        expect(metrics!.tradesCompleted).to.equal(0);
      }
    });
  });

  // ---------- Bot retrieval ----------

  describe('Bot retrieval', () => {
    it('should retrieve a bot by ID', () => {
      const bots = manager.getAllBots();
      const firstBot = bots[0];
      const found = manager.getBot(firstBot.id);
      expect(found).to.exist;
      expect(found!.id).to.equal(firstBot.id);
    });

    it('should return undefined for unknown bot ID', () => {
      const found = manager.getBot('nonexistent-bot-id');
      expect(found).to.be.undefined;
    });

    it('should retrieve a bot by archetype', () => {
      const abio = manager.getBotByArchetype('abiogenesis');
      expect(abio).to.exist;
      expect(abio!.archetype).to.equal('abiogenesis');
    });
  });

  // ---------- Internal competition ranking ----------

  describe('Internal competition ranking', () => {
    it('should return rankings for all 4 bots', () => {
      const rankings = manager.evaluateInternalCompetition();
      expect(rankings).to.have.length(4);
    });

    it('should sort rankings by score descending', () => {
      const rankings = manager.evaluateInternalCompetition();
      for (let i = 1; i < rankings.length; i++) {
        expect(rankings[i - 1].score).to.be.gte(rankings[i].score);
      }
    });

    it('should include id, name, score, and trades in each ranking entry', () => {
      const rankings = manager.evaluateInternalCompetition();
      for (const r of rankings) {
        expect(r).to.have.property('id');
        expect(r).to.have.property('name');
        expect(r).to.have.property('score');
        expect(r).to.have.property('trades');
      }
    });
  });

  // ---------- Team winner ----------

  describe('Team winner', () => {
    it('should return null when no bots have trades', () => {
      const winner = manager.getTeamWinner();
      expect(winner).to.be.null;
    });
  });

  // ---------- Serialization / Deserialization ----------

  describe('Serialization / Deserialization', () => {
    it('should round-trip through serialize/deserialize', () => {
      const serialized = manager.serialize();
      expect(serialized).to.have.length(4);

      const newTracker = new PerformanceTracker();
      const newManager = new FrontierManager(newTracker);
      newManager.deserialize(serialized);

      const restored = newManager.getAllBots();
      expect(restored).to.have.length(4);

      // Verify IDs match
      const originalIds = serialized.map(b => b.id).sort();
      const restoredIds = restored.map(b => b.id).sort();
      expect(restoredIds).to.deep.equal(originalIds);
    });

    it('should preserve bot archetypes through serialization', () => {
      const serialized = manager.serialize();
      const archetypes = serialized.map(b => b.archetype).sort();
      expect(archetypes).to.deep.equal(['abiogenesis', 'cambrian', 'mitosis', 'symbiont']);
    });
  });
});
