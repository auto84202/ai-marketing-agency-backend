import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface ABTestConfig {
  campaignId: string;
  variantAId: string;
  variantBId: string;
  name: string;
  hypothesis?: string;
  trafficSplit?: number;
  minSampleSize?: number;
  maxDuration?: number; // in days
  significanceLevel?: number;
  primaryMetric?: 'CTR' | 'CONVERSION_RATE' | 'ROAS' | 'CPA';
  secondaryMetrics?: string[];
}

export interface ABTestResult {
  testId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'PAUSED';
  currentSampleSize: number;
  requiredSampleSize: number;
  statisticalSignificance: number;
  confidence: number;
  winner: 'A' | 'B' | 'NO_WINNER' | 'INCONCLUSIVE';
  variantA: {
    id: string;
    performance: TestVariantPerformance;
  };
  variantB: {
    id: string;
    performance: TestVariantPerformance;
  };
  mlRecommendations: MLRecommendation[];
  nextSteps: string[];
  estimatedCompletionDate?: Date;
}

export interface TestVariantPerformance {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue?: number;
  ctr: number;
  conversionRate: number;
  cpa: number;
  roas: number;
  confidence: number;
  statisticalPower: number;
}

export interface MLRecommendation {
  type: 'CONTINUE' | 'STOP' | 'MODIFY' | 'SCALE';
  confidence: number;
  reasoning: string;
  expectedImpact: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface BayesianAnalysis {
  variantA: {
    posteriorMean: number;
    posteriorVariance: number;
    probabilityOfBeingBest: number;
    credibleInterval: [number, number];
  };
  variantB: {
    posteriorMean: number;
    posteriorVariance: number;
    probabilityOfBeingBest: number;
    credibleInterval: [number, number];
  };
  probabilityOfDifference: number;
  expectedLift: number;
  riskOfError: number;
}

@Injectable()
export class ABTestingService {
  private readonly logger = new Logger(ABTestingService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * Create a new A/B test
   */
  async createABTest(userId: string, config: ABTestConfig): Promise<any> {
    try {
      this.logger.log(`Creating A/B test: ${config.name} for campaign: ${config.campaignId}`);

      // Validate test configuration
      await this.validateTestConfig(config);

      // Calculate required sample size
      const requiredSampleSize = this.calculateRequiredSampleSize(config);

      // Create test in database
      const abTest = await this.prisma.aBTest.create({
        data: {
          adCampaignId: config.campaignId,
          variantAId: config.variantAId,
          variantBId: config.variantBId,
          name: config.name,
          hypothesis: config.hypothesis,
          trafficSplit: config.trafficSplit || 0.5,
          minSampleSize: requiredSampleSize,
          testDuration: config.maxDuration || 30,
          status: 'ACTIVE',
          startDate: new Date(),
        },
      });

      // Initialize test monitoring
      await this.initializeTestMonitoring(abTest.id);

      this.logger.log(`A/B test created successfully: ${abTest.id}`);
      return abTest;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create A/B test: ${msg}`);
      throw error;
    }
  }

  /**
   * Monitor active A/B tests and update results
   */
  @Cron(CronExpression.EVERY_HOUR)
  async monitorActiveTests(): Promise<void> {
    try {
      this.logger.log('Monitoring active A/B tests...');

      const activeTests = await this.prisma.aBTest.findMany({
        where: { status: 'ACTIVE' },
        include: {
          variantA: true,
          variantB: true,
          adCampaign: true,
        },
      });

      for (const test of activeTests) {
        await this.updateTestResults(test);
      }

      this.logger.log(`Monitored ${activeTests.length} active tests`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error monitoring A/B tests: ${msg}`);
    }
  }

  /**
   * Update test results with latest performance data
   */
  async updateTestResults(test: any): Promise<ABTestResult> {
    try {
      // Get current performance data
      const variantAPerformance = await this.getVariantPerformance(test.variantAId);
      const variantBPerformance = await this.getVariantPerformance(test.variantBId);

      // Perform statistical analysis
      const statisticalAnalysis = this.performStatisticalAnalysis(
        variantAPerformance,
        variantBPerformance,
        test,
      );

      // Perform Bayesian analysis
      const bayesianAnalysis = this.performBayesianAnalysis(
        variantAPerformance,
        variantBPerformance,
      );

      // Apply ML algorithms for winner determination
      const mlRecommendations = await this.applyMLWinnerSelection(
        variantAPerformance,
        variantBPerformance,
        statisticalAnalysis,
        bayesianAnalysis,
        test,
      );

      // Determine if test should continue or conclude
      const shouldConclude = this.shouldConcludeTest(
        statisticalAnalysis,
        bayesianAnalysis,
        test,
        variantAPerformance,
        variantBPerformance,
      );

      // Update test status and results
      const updatedTest = await this.updateTestInDatabase(
        test.id,
        {
          currentSampleSize: variantAPerformance.impressions + variantBPerformance.impressions,
          statisticalSignificance: statisticalAnalysis.significance,
          confidence: statisticalAnalysis.confidence,
          winnerId: shouldConclude ? this.determineWinner(statisticalAnalysis, bayesianAnalysis) : null,
          status: shouldConclude ? 'COMPLETED' : 'ACTIVE',
          results: {
            statisticalAnalysis,
            bayesianAnalysis,
            mlRecommendations,
            variantAPerformance,
            variantBPerformance,
          },
          mlRecommendations: mlRecommendations,
        },
      );

      return this.formatTestResult(updatedTest, variantAPerformance, variantBPerformance, mlRecommendations);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error updating test results for ${test.id}: ${msg}`);
      throw error;
    }
  }

  /**
   * Get variant performance data
   */
  private async getVariantPerformance(variantId: string): Promise<TestVariantPerformance> {
    // In a real implementation, this would fetch from ad platform APIs
    // For now, we'll simulate realistic performance data
    return this.simulateVariantPerformance(variantId);
  }

  /**
   * Simulate variant performance data
   */
  private simulateVariantPerformance(variantId: string): TestVariantPerformance {
    const baseImpressions = 1000 + Math.random() * 2000;
    const baseCtr = 0.015 + Math.random() * 0.03;
    const baseConversionRate = 0.02 + Math.random() * 0.04;
    const baseCpc = 0.8 + Math.random() * 1.2;

    const impressions = Math.floor(baseImpressions);
    const clicks = Math.floor(impressions * baseCtr);
    const conversions = Math.floor(clicks * baseConversionRate);
    const spend = clicks * baseCpc;
    const revenue = conversions * 50; // Assume $50 average order value

    return {
      impressions,
      clicks,
      conversions,
      spend,
      revenue,
      ctr: baseCtr,
      conversionRate: baseConversionRate,
      cpa: conversions > 0 ? spend / conversions : 0,
      roas: revenue / spend,
      confidence: Math.min(0.95, 0.6 + Math.random() * 0.3),
      statisticalPower: Math.min(0.99, 0.7 + Math.random() * 0.25),
    };
  }

  /**
   * Perform statistical analysis on test results
   */
  private performStatisticalAnalysis(
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
    test: any,
  ): any {
    // Chi-square test for conversion rates
    const conversionTest = this.performChiSquareTest(
      variantA.clicks,
      variantA.conversions,
      variantB.clicks,
      variantB.conversions,
    );

    // T-test for continuous metrics (CTR, CPA, ROAS)
    const ctrTest = this.performTTest(
      variantA.ctr,
      variantA.impressions,
      variantB.ctr,
      variantB.impressions,
    );

    const roasTest = this.performTTest(
      variantA.roas,
      variantA.conversions,
      variantB.roas,
      variantB.conversions,
    );

    // Calculate overall significance
    const overallSignificance = Math.min(
      conversionTest.pValue,
      ctrTest.pValue,
      roasTest.pValue,
    );

    return {
      conversionTest,
      ctrTest,
      roasTest,
      significance: 1 - overallSignificance,
      confidence: 1 - overallSignificance,
      power: this.calculateStatisticalPower(variantA, variantB),
      effectSize: this.calculateEffectSize(variantA, variantB),
    };
  }

  /**
   * Perform Bayesian analysis
   */
  private performBayesianAnalysis(
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
  ): BayesianAnalysis {
    // Beta-Binomial model for conversion rates
    const alphaA = 1; // Prior alpha
    const betaA = 1; // Prior beta
    const alphaB = 1;
    const betaB = 1;

    // Update posteriors
    const posteriorAlphaA = alphaA + variantA.conversions;
    const posteriorBetaA = betaA + variantA.clicks - variantA.conversions;
    const posteriorAlphaB = alphaB + variantB.conversions;
    const posteriorBetaB = betaB + variantB.clicks - variantB.conversions;

    // Calculate posterior means and variances
    const meanA = posteriorAlphaA / (posteriorAlphaA + posteriorBetaA);
    const meanB = posteriorAlphaB / (posteriorAlphaB + posteriorBetaB);
    const varA = (posteriorAlphaA * posteriorBetaA) / 
      ((posteriorAlphaA + posteriorBetaA) ** 2 * (posteriorAlphaA + posteriorBetaA + 1));
    const varB = (posteriorAlphaB * posteriorBetaB) / 
      ((posteriorAlphaB + posteriorBetaB) ** 2 * (posteriorAlphaB + posteriorBetaB + 1));

    // Monte Carlo simulation to estimate probability of A being better
    const probabilityOfABetter = this.monteCarloSimulation(
      posteriorAlphaA,
      posteriorBetaA,
      posteriorAlphaB,
      posteriorBetaB,
      10000,
    );

    return {
      variantA: {
        posteriorMean: meanA,
        posteriorVariance: varA,
        probabilityOfBeingBest: probabilityOfABetter,
        credibleInterval: this.calculateCredibleInterval(posteriorAlphaA, posteriorBetaA, 0.95),
      },
      variantB: {
        posteriorMean: meanB,
        posteriorVariance: varB,
        probabilityOfBeingBest: 1 - probabilityOfABetter,
        credibleInterval: this.calculateCredibleInterval(posteriorAlphaB, posteriorBetaB, 0.95),
      },
      probabilityOfDifference: Math.abs(probabilityOfABetter - 0.5) * 2,
      expectedLift: (meanA - meanB) / meanB,
      riskOfError: Math.min(probabilityOfABetter, 1 - probabilityOfABetter),
    };
  }

  /**
   * Apply ML algorithms for winner selection
   */
  private async applyMLWinnerSelection(
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
    statisticalAnalysis: any,
    bayesianAnalysis: BayesianAnalysis,
    test: any,
  ): Promise<MLRecommendation[]> {
    const recommendations: MLRecommendation[] = [];

    // Multi-criteria decision making
    const scores = this.calculateMultiCriteriaScores(variantA, variantB);

    // Early stopping recommendation
    if (this.shouldStopEarly(statisticalAnalysis, bayesianAnalysis, test)) {
      recommendations.push({
        type: 'STOP',
        confidence: Math.max(statisticalAnalysis.confidence, bayesianAnalysis.probabilityOfDifference),
        reasoning: 'Sufficient statistical evidence to conclude test early',
        expectedImpact: 'Save budget and implement winning variant sooner',
        priority: 'HIGH',
      });
    }

    // Winner recommendation
    if (statisticalAnalysis.confidence > 0.95 || bayesianAnalysis.probabilityOfDifference > 0.95) {
      const winner = scores.variantA > scores.variantB ? 'A' : 'B';
      recommendations.push({
        type: 'SCALE',
        confidence: Math.max(statisticalAnalysis.confidence, bayesianAnalysis.probabilityOfDifference),
        reasoning: `Variant ${winner} shows clear superiority with ${(Math.abs(scores.variantA - scores.variantB) * 100).toFixed(1)}% performance difference`,
        expectedImpact: `Implementing variant ${winner} could improve overall campaign performance by ${Math.abs(bayesianAnalysis.expectedLift * 100).toFixed(1)}%`,
        priority: 'HIGH',
      });
    }

    // Continue testing recommendation
    if (statisticalAnalysis.confidence < 0.8 && bayesianAnalysis.probabilityOfDifference < 0.8) {
      recommendations.push({
        type: 'CONTINUE',
        confidence: 0.7,
        reasoning: 'Insufficient statistical evidence to make a confident decision',
        expectedImpact: 'Continue testing to gather more data and reduce uncertainty',
        priority: 'MEDIUM',
      });
    }

    // Modification recommendations
    if (this.needsModification(variantA, variantB, statisticalAnalysis)) {
      recommendations.push({
        type: 'MODIFY',
        confidence: 0.8,
        reasoning: 'Test setup may need adjustment for better performance',
        expectedImpact: 'Improve test design for more reliable results',
        priority: 'MEDIUM',
      });
    }

    return recommendations;
  }

  /**
   * Calculate multi-criteria scores for variants
   */
  private calculateMultiCriteriaScores(
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
  ): { variantA: number; variantB: number } {
    // Weighted scoring based on multiple metrics
    const weights = {
      ctr: 0.25,
      conversionRate: 0.35,
      roas: 0.25,
      cpa: 0.15,
    };

    const scoreA = 
      variantA.ctr * weights.ctr * 100 +
      variantA.conversionRate * weights.conversionRate * 100 +
      variantA.roas * weights.roas * 10 +
      (1 / Math.max(variantA.cpa, 0.1)) * weights.cpa * 10;

    const scoreB = 
      variantB.ctr * weights.ctr * 100 +
      variantB.conversionRate * weights.conversionRate * 100 +
      variantB.roas * weights.roas * 10 +
      (1 / Math.max(variantB.cpa, 0.1)) * weights.cpa * 10;

    return { variantA: scoreA, variantB: scoreB };
  }

  /**
   * Determine if test should conclude
   */
  private shouldConcludeTest(
    statisticalAnalysis: any,
    bayesianAnalysis: BayesianAnalysis,
    test: any,
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
  ): boolean {
    const totalSampleSize = variantA.impressions + variantB.impressions;
    
    // Check if minimum sample size reached
    if (totalSampleSize < test.minSampleSize) {
      return false;
    }

    // Check if maximum duration reached
    const daysRunning = (Date.now() - new Date(test.startDate).getTime()) / (1000 * 60 * 60 * 24);
    if (test.testDuration && daysRunning >= test.testDuration) {
      return true;
    }

    // Check statistical significance
    if (statisticalAnalysis.confidence >= 0.95 || bayesianAnalysis.probabilityOfDifference >= 0.95) {
      return true;
    }

    // Check for early stopping conditions
    if (this.shouldStopEarly(statisticalAnalysis, bayesianAnalysis, test)) {
      return true;
    }

    return false;
  }

  /**
   * Determine test winner
   */
  private determineWinner(statisticalAnalysis: any, bayesianAnalysis: BayesianAnalysis): string | null {
    if (statisticalAnalysis.confidence < 0.8 && bayesianAnalysis.probabilityOfDifference < 0.8) {
      return null; // No clear winner
    }

    // Use Bayesian probability for winner determination
    return bayesianAnalysis.variantA.probabilityOfBeingBest > 0.5 ? 'A' : 'B';
  }

  /**
   * Check if test should stop early
   */
  private shouldStopEarly(
    statisticalAnalysis: any,
    bayesianAnalysis: BayesianAnalysis,
    test: any,
  ): boolean {
    // Futility stopping: if it's very unlikely to reach significance
    if (statisticalAnalysis.power < 0.3 && bayesianAnalysis.riskOfError > 0.4) {
      return true;
    }

    // Efficacy stopping: if we have strong evidence
    if (statisticalAnalysis.confidence > 0.99 || bayesianAnalysis.probabilityOfDifference > 0.99) {
      return true;
    }

    return false;
  }

  /**
   * Check if test needs modification
   */
  private needsModification(
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
    statisticalAnalysis: any,
  ): boolean {
    // Check for extreme performance differences that might indicate test issues
    const ctrDifference = Math.abs(variantA.ctr - variantB.ctr) / Math.max(variantA.ctr, variantB.ctr);
    const conversionDifference = Math.abs(variantA.conversionRate - variantB.conversionRate) / 
      Math.max(variantA.conversionRate, variantB.conversionRate);

    if (ctrDifference > 0.5 || conversionDifference > 0.5) {
      return true; // Suspiciously large differences
    }

    return false;
  }

  /**
   * Update test in database
   */
  private async updateTestInDatabase(testId: string, updateData: any): Promise<any> {
    return await this.prisma.aBTest.update({
      where: { id: testId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Format test result for API response
   */
  private formatTestResult(
    test: any,
    variantAPerformance: TestVariantPerformance,
    variantBPerformance: TestVariantPerformance,
    mlRecommendations: MLRecommendation[],
  ): ABTestResult {
    const nextSteps = this.generateNextSteps(test, mlRecommendations);

    return {
      testId: test.id,
      status: test.status,
      currentSampleSize: test.currentSampleSize,
      requiredSampleSize: test.minSampleSize,
      statisticalSignificance: test.statisticalSignificance,
      confidence: test.confidence,
      winner: test.winnerId as any,
      variantA: {
        id: test.variantAId,
        performance: variantAPerformance,
      },
      variantB: {
        id: test.variantBId,
        performance: variantBPerformance,
      },
      mlRecommendations,
      nextSteps,
      estimatedCompletionDate: this.estimateCompletionDate(test, variantAPerformance, variantBPerformance),
    };
  }

  /**
   * Generate next steps based on test results
   */
  private generateNextSteps(test: any, recommendations: MLRecommendation[]): string[] {
    const steps: string[] = [];

    if (test.status === 'COMPLETED') {
      if (test.winnerId) {
        steps.push(`Implement winning variant ${test.winnerId} across the campaign`);
        steps.push('Scale budget allocation to the winning variant');
        steps.push('Monitor performance of the implemented variant');
      } else {
        steps.push('No clear winner found - consider testing different variations');
        steps.push('Analyze test setup for potential improvements');
        steps.push('Consider combining best elements from both variants');
      }
    } else {
      steps.push('Continue monitoring test performance');
      steps.push('Review ML recommendations for optimization opportunities');
      steps.push('Ensure sufficient sample size for statistical significance');
    }

    // Add specific recommendations
    recommendations.forEach(rec => {
      if (rec.type === 'SCALE' && rec.priority === 'HIGH') {
        steps.push(`High priority: ${rec.reasoning}`);
      }
    });

    return steps;
  }

  /**
   * Estimate test completion date
   */
  private estimateCompletionDate(
    test: any,
    variantA: TestVariantPerformance,
    variantB: TestVariantPerformance,
  ): Date | undefined {
    if (test.status === 'COMPLETED') {
      return undefined;
    }

    const currentSampleSize = variantA.impressions + variantB.impressions;
    const remainingSampleSize = test.minSampleSize - currentSampleSize;
    
    if (remainingSampleSize <= 0) {
      return new Date(); // Should complete soon
    }

    // Estimate based on current traffic rate
    const dailyTrafficRate = currentSampleSize / Math.max(1, 
      (Date.now() - new Date(test.startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    const daysRemaining = Math.ceil(remainingSampleSize / dailyTrafficRate);
    const completionDate = new Date();
    completionDate.setDate(completionDate.getDate() + daysRemaining);
    
    return completionDate;
  }

  /**
   * Statistical analysis helper methods
   */
  private performChiSquareTest(
    clicksA: number,
    conversionsA: number,
    clicksB: number,
    conversionsB: number,
  ): any {
    const nonConversionsA = clicksA - conversionsA;
    const nonConversionsB = clicksB - conversionsB;
    
    const totalClicks = clicksA + clicksB;
    const totalConversions = conversionsA + conversionsB;
    const totalNonConversions = nonConversionsA + nonConversionsB;
    
    const expectedConversionsA = (totalConversions * clicksA) / totalClicks;
    const expectedNonConversionsA = (totalNonConversions * clicksA) / totalClicks;
    const expectedConversionsB = (totalConversions * clicksB) / totalClicks;
    const expectedNonConversionsB = (totalNonConversions * clicksB) / totalClicks;
    
    const chiSquare = 
      Math.pow(conversionsA - expectedConversionsA, 2) / expectedConversionsA +
      Math.pow(nonConversionsA - expectedNonConversionsA, 2) / expectedNonConversionsA +
      Math.pow(conversionsB - expectedConversionsB, 2) / expectedConversionsB +
      Math.pow(nonConversionsB - expectedNonConversionsB, 2) / expectedNonConversionsB;
    
    // Simplified p-value calculation (in practice, use proper chi-square distribution)
    const pValue = Math.exp(-chiSquare / 2);
    
    return {
      chiSquare,
      pValue,
      degreesOfFreedom: 1,
      significant: pValue < 0.05,
    };
  }

  private performTTest(
    meanA: number,
    nA: number,
    meanB: number,
    nB: number,
  ): any {
    // Simplified t-test calculation
    const pooledVariance = (nA + nB) / ((nA - 1) + (nB - 1));
    const standardError = Math.sqrt(pooledVariance * (1/nA + 1/nB));
    const tStatistic = (meanA - meanB) / standardError;
    
    // Simplified p-value calculation
    const pValue = 2 * (1 - this.normalCDF(Math.abs(tStatistic)));
    
    return {
      tStatistic,
      pValue,
      degreesOfFreedom: nA + nB - 2,
      significant: pValue < 0.05,
    };
  }

  private calculateStatisticalPower(variantA: TestVariantPerformance, variantB: TestVariantPerformance): number {
    // Simplified power calculation
    const effectSize = Math.abs(variantA.conversionRate - variantB.conversionRate);
    const sampleSize = variantA.clicks + variantB.clicks;
    const power = Math.min(0.99, 0.5 + effectSize * Math.sqrt(sampleSize) * 0.1);
    return power;
  }

  private calculateEffectSize(variantA: TestVariantPerformance, variantB: TestVariantPerformance): number {
    const pooledStd = Math.sqrt((variantA.conversionRate + variantB.conversionRate) / 2);
    return Math.abs(variantA.conversionRate - variantB.conversionRate) / pooledStd;
  }

  private monteCarloSimulation(
    alphaA: number,
    betaA: number,
    alphaB: number,
    betaB: number,
    iterations: number,
  ): number {
    let aWins = 0;
    
    for (let i = 0; i < iterations; i++) {
      const sampleA = this.sampleBeta(alphaA, betaA);
      const sampleB = this.sampleBeta(alphaB, betaB);
      
      if (sampleA > sampleB) {
        aWins++;
      }
    }
    
    return aWins / iterations;
  }

  private sampleBeta(alpha: number, beta: number): number {
    // Simplified beta sampling using gamma distribution approximation
    const gammaA = this.sampleGamma(alpha);
    const gammaB = this.sampleGamma(beta);
    return gammaA / (gammaA + gammaB);
  }

  private sampleGamma(shape: number): number {
    // Simplified gamma sampling (in practice, use proper gamma sampling)
    return Math.random() * shape * 2;
  }

  private calculateCredibleInterval(alpha: number, beta: number, confidence: number): [number, number] {
    // Simplified credible interval calculation
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stdDev = Math.sqrt(variance);
    const zScore = confidence === 0.95 ? 1.96 : 2.58;
    
    return [
      Math.max(0, mean - zScore * stdDev),
      Math.min(1, mean + zScore * stdDev),
    ];
  }

  private normalCDF(x: number): number {
    // Approximation of normal CDF
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  private calculateRequiredSampleSize(config: ABTestConfig): number {
    // Simplified sample size calculation based on expected effect size
    const expectedEffectSize = 0.1; // 10% improvement
    const power = 0.8;
    const alpha = 0.05;
    
    // Using formula for two-proportion z-test
    const zAlpha = 1.96; // For alpha = 0.05
    const zBeta = 0.84; // For power = 0.8
    
    const sampleSize = Math.pow(zAlpha + zBeta, 2) * 2 * 0.5 * (1 - 0.5) / Math.pow(expectedEffectSize, 2);
    
    return Math.ceil(sampleSize);
  }

  private validateTestConfig(config: ABTestConfig): Promise<void> {
    // Validate test configuration
    if (!config.campaignId || !config.variantAId || !config.variantBId) {
      throw new Error('Missing required test configuration');
    }

    if (config.trafficSplit && (config.trafficSplit < 0.1 || config.trafficSplit > 0.9)) {
      throw new Error('Traffic split must be between 0.1 and 0.9');
    }

    if (config.minSampleSize && config.minSampleSize < 100) {
      throw new Error('Minimum sample size must be at least 100');
    }

    return Promise.resolve();
  }

  private initializeTestMonitoring(testId: string): Promise<void> {
    this.logger.log(`Initialized monitoring for test: ${testId}`);
    return Promise.resolve();
  }

  /**
   * Get test results for a specific test
   */
  async getTestResults(testId: string): Promise<ABTestResult> {
    const test = await this.prisma.aBTest.findUnique({
      where: { id: testId },
      include: {
        variantA: true,
        variantB: true,
      },
    });

    if (!test) {
      throw new Error('Test not found');
    }

    const variantAPerformance = await this.getVariantPerformance(test.variantAId);
    const variantBPerformance = await this.getVariantPerformance(test.variantBId);

      return this.formatTestResult(
        test,
        variantAPerformance,
        variantBPerformance,
        (test.mlRecommendations as any) || [],
      );
  }

  /**
   * Get all tests for a campaign
   */
  async getCampaignTests(campaignId: string): Promise<ABTestResult[]> {
    const tests = await this.prisma.aBTest.findMany({
      where: { adCampaignId: campaignId },
      include: {
        variantA: true,
        variantB: true,
      },
    });

    const results = [];
    for (const test of tests) {
      const variantAPerformance = await this.getVariantPerformance(test.variantAId);
      const variantBPerformance = await this.getVariantPerformance(test.variantBId);
      
      results.push(this.formatTestResult(
        test,
        variantAPerformance,
        variantBPerformance,
        (test.mlRecommendations as any) || [],
      ));
    }

    return results;
  }

  /**
   * Cancel a test
   */
  async cancelTest(testId: string, reason?: string): Promise<void> {
    await this.prisma.aBTest.update({
      where: { id: testId },
      data: {
        status: 'CANCELLED',
        results: {
          cancellationReason: reason || 'Test cancelled by user',
        },
      },
    });

    this.logger.log(`Test cancelled: ${testId}`);
  }
}
