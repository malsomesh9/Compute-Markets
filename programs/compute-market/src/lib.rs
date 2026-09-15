use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use solana_sha256_hasher::hashv;

declare_id!("HsjKrSHNqXgqkDmyp1PAhhFAa16GHfeRNZ9s6Zuqpfyd");

const CREATED: u8 = 0;
const OPEN: u8 = 2;
const ASSIGNED: u8 = 4;
const RUNNING: u8 = 6;
const VERIFYING: u8 = 8;
const COMPLETED: u8 = 9;
const CANCELLED: u8 = 10;
const EXPIRED: u8 = 11;
const FAILED: u8 = 12;
const DISPUTED: u8 = 13;
const REFUNDED: u8 = 14;
const STAKE_COOLDOWN_SECONDS: i64 = 7 * 24 * 60 * 60;

#[program]
pub mod compute_market {
    use super::*;
    pub fn initialize_protocol(
        ctx: Context<Initialize>,
        fee_bps: u16,
        dispute_seconds: i64,
    ) -> Result<()> {
        require!(
            fee_bps <= 300 && (1..=604800).contains(&dispute_seconds),
            MarketError::Bounds
        );
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.mint = ctx.accounts.mint.key();
        c.treasury = ctx.accounts.treasury.key();
        c.verifier = ctx.accounts.verifier.key();
        c.resolver = ctx.accounts.admin.key();
        c.fee_bps = fee_bps;
        c.dispute_seconds = dispute_seconds;
        c.bump = ctx.bumps.config;
        Ok(())
    }
    pub fn pause_protocol(ctx: Context<Admin>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }
    pub fn update_protocol(
        ctx: Context<Admin>,
        fee_bps: u16,
        dispute_seconds: i64,
        treasury: Pubkey,
        verifier: Pubkey,
        resolver: Pubkey,
    ) -> Result<()> {
        require!(
            fee_bps <= 300 && (1..=604800).contains(&dispute_seconds),
            MarketError::Bounds
        );
        let config = &mut ctx.accounts.config;
        config.fee_bps = fee_bps;
        config.dispute_seconds = dispute_seconds;
        config.treasury = treasury;
        config.verifier = verifier;
        config.resolver = resolver;
        Ok(())
    }
    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        let p = &mut ctx.accounts.provider;
        p.authority = ctx.accounts.authority.key();
        p.metadata_hash = metadata_hash;
        p.active = true;
        p.bump = ctx.bumps.provider;
        Ok(())
    }
    pub fn update_provider(
        ctx: Context<ManageProvider>,
        metadata_hash: [u8; 32],
        active: bool,
    ) -> Result<()> {
        ctx.accounts.provider.metadata_hash = metadata_hash;
        ctx.accounts.provider.active = active;
        Ok(())
    }
    pub fn create_agent_policy(
        ctx: Context<CreateAgentPolicy>,
        daily_spend_limit: u64,
        single_job_limit: u64,
        max_runtime_seconds: u32,
        required_verification: u8,
        allowed_specs_root: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        validate_agent_policy(
            daily_spend_limit,
            single_job_limit,
            max_runtime_seconds,
            required_verification,
            allowed_specs_root,
            expires_at,
        )?;
        let policy = &mut ctx.accounts.agent_policy;
        policy.owner = ctx.accounts.owner.key();
        policy.agent = ctx.accounts.agent.key();
        policy.mint = ctx.accounts.mint.key();
        policy.daily_spend_limit = daily_spend_limit;
        policy.single_job_limit = single_job_limit;
        policy.max_runtime_seconds = max_runtime_seconds;
        policy.required_verification = required_verification;
        policy.allowed_specs_root = allowed_specs_root;
        policy.expires_at = expires_at;
        policy.day_index = Clock::get()?.unix_timestamp.div_euclid(86_400);
        policy.active = true;
        policy.bump = ctx.bumps.agent_policy;
        Ok(())
    }
    pub fn update_agent_policy(
        ctx: Context<ManageAgentPolicy>,
        daily_spend_limit: u64,
        single_job_limit: u64,
        max_runtime_seconds: u32,
        required_verification: u8,
        allowed_specs_root: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        validate_agent_policy(
            daily_spend_limit,
            single_job_limit,
            max_runtime_seconds,
            required_verification,
            allowed_specs_root,
            expires_at,
        )?;
        let policy = &mut ctx.accounts.agent_policy;
        require!(daily_spend_limit >= policy.daily_spent, MarketError::Bounds);
        policy.daily_spend_limit = daily_spend_limit;
        policy.single_job_limit = single_job_limit;
        policy.max_runtime_seconds = max_runtime_seconds;
        policy.required_verification = required_verification;
        policy.allowed_specs_root = allowed_specs_root;
        policy.expires_at = expires_at;
        policy.active = true;
        Ok(())
    }
    pub fn revoke_agent_policy(ctx: Context<ManageAgentPolicy>) -> Result<()> {
        ctx.accounts.agent_policy.active = false;
        Ok(())
    }
    pub fn initialize_provider_stake(ctx: Context<InitializeProviderStake>) -> Result<()> {
        let stake = &mut ctx.accounts.stake;
        stake.provider = ctx.accounts.provider.key();
        stake.mint = ctx.accounts.mint.key();
        stake.bump = ctx.bumps.stake;
        Ok(())
    }
    pub fn deposit_stake(ctx: Context<DepositStake>, amount: u64) -> Result<()> {
        require!(amount > 0, MarketError::Bounds);
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let stake = &mut ctx.accounts.stake;
        stake.deposited = stake
            .deposited
            .checked_add(amount)
            .ok_or(MarketError::Overflow)?;
        emit_stake(stake.provider, 0, amount, stake.deposited);
        Ok(())
    }
    pub fn request_unstake(ctx: Context<ManageStake>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.stake;
        require!(amount > 0 && amount <= stake.deposited, MarketError::Bounds);
        stake.pending_withdrawal = amount;
        stake.unlock_at = Clock::get()?
            .unix_timestamp
            .checked_add(STAKE_COOLDOWN_SECONDS)
            .ok_or(MarketError::Overflow)?;
        emit_stake(stake.provider, 1, amount, stake.deposited);
        Ok(())
    }
    pub fn cancel_unstake(ctx: Context<ManageStake>) -> Result<()> {
        let stake = &mut ctx.accounts.stake;
        require!(stake.pending_withdrawal > 0, MarketError::State);
        let amount = stake.pending_withdrawal;
        stake.pending_withdrawal = 0;
        stake.unlock_at = 0;
        emit_stake(stake.provider, 2, amount, stake.deposited);
        Ok(())
    }
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        let stake = &ctx.accounts.stake;
        let amount = stake.pending_withdrawal;
        require!(
            amount > 0
                && amount <= stake.deposited
                && Clock::get()?.unix_timestamp >= stake.unlock_at,
            MarketError::State
        );
        let provider = stake.provider;
        let bump = [stake.bump];
        let seeds: &[&[u8]] = &[b"stake", provider.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.stake.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let stake = &mut ctx.accounts.stake;
        stake.deposited = stake
            .deposited
            .checked_sub(amount)
            .ok_or(MarketError::Overflow)?;
        stake.pending_withdrawal = 0;
        stake.unlock_at = 0;
        emit_stake(stake.provider, 3, amount, stake.deposited);
        Ok(())
    }
    pub fn slash_stake(ctx: Context<SlashStake>, amount: u64) -> Result<()> {
        let stake = &ctx.accounts.stake;
        require!(amount > 0 && amount <= stake.deposited, MarketError::Bounds);
        let provider = stake.provider;
        let bump = [stake.bump];
        let seeds: &[&[u8]] = &[b"stake", provider.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.stake.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let stake = &mut ctx.accounts.stake;
        stake.deposited = stake
            .deposited
            .checked_sub(amount)
            .ok_or(MarketError::Overflow)?;
        stake.total_slashed = stake
            .total_slashed
            .checked_add(amount)
            .ok_or(MarketError::Overflow)?;
        stake.pending_withdrawal = stake.pending_withdrawal.min(stake.deposited);
        if stake.pending_withdrawal == 0 {
            stake.unlock_at = 0;
        }
        emit_stake(stake.provider, 4, amount, stake.deposited);
        Ok(())
    }
    pub fn authorize_worker(ctx: Context<AuthorizeWorker>, expires_at: i64) -> Result<()> {
        require!(
            expires_at > Clock::get()?.unix_timestamp,
            MarketError::Expired
        );
        let w = &mut ctx.accounts.worker_auth;
        w.provider = ctx.accounts.provider.key();
        w.worker = ctx.accounts.worker.key();
        w.active = true;
        w.expires_at = expires_at;
        w.bump = ctx.bumps.worker_auth;
        Ok(())
    }
    pub fn revoke_worker(ctx: Context<RevokeWorker>) -> Result<()> {
        ctx.accounts.worker_auth.active = false;
        Ok(())
    }
    pub fn rotate_worker(ctx: Context<RotateWorker>, expires_at: i64) -> Result<()> {
        require!(
            expires_at > Clock::get()?.unix_timestamp,
            MarketError::Expired
        );
        require_keys_neq!(
            ctx.accounts.old_worker_auth.worker,
            ctx.accounts.new_worker.key(),
            MarketError::Bounds
        );
        ctx.accounts.old_worker_auth.active = false;
        let worker = &mut ctx.accounts.new_worker_auth;
        worker.provider = ctx.accounts.provider.key();
        worker.worker = ctx.accounts.new_worker.key();
        worker.active = true;
        worker.expires_at = expires_at;
        worker.bump = ctx.bumps.new_worker_auth;
        Ok(())
    }
    pub fn register_machine(
        ctx: Context<RegisterMachine>,
        id: [u8; 32],
        hardware_hash: [u8; 32],
        gpu_count: u16,
        vram_mb: u32,
    ) -> Result<()> {
        require!(
            gpu_count <= 16 && ((gpu_count == 0 && vram_mb == 0) || (gpu_count > 0 && vram_mb > 0)),
            MarketError::Bounds
        );
        let m = &mut ctx.accounts.machine;
        m.provider = ctx.accounts.provider.key();
        m.worker = ctx.accounts.worker_auth.worker;
        m.id = id;
        m.hardware_hash = hardware_hash;
        m.gpu_count = gpu_count;
        m.vram_mb = vram_mb;
        m.active = true;
        m.bump = ctx.bumps.machine;
        Ok(())
    }
    pub fn update_machine(
        ctx: Context<ManageMachine>,
        hardware_hash: [u8; 32],
        gpu_count: u16,
        vram_mb: u32,
    ) -> Result<()> {
        require!(
            !ctx.accounts.machine.busy
                && gpu_count <= 16
                && ((gpu_count == 0 && vram_mb == 0) || (gpu_count > 0 && vram_mb > 0))
                && hardware_hash != [0; 32],
            MarketError::Bounds
        );
        active_worker(&ctx.accounts.worker_auth, Clock::get()?.unix_timestamp)?;
        let machine = &mut ctx.accounts.machine;
        machine.worker = ctx.accounts.worker_auth.worker;
        machine.hardware_hash = hardware_hash;
        machine.gpu_count = gpu_count;
        machine.vram_mb = vram_mb;
        Ok(())
    }
    pub fn deactivate_machine(ctx: Context<DeactivateMachine>) -> Result<()> {
        require!(!ctx.accounts.machine.busy, MarketError::Capacity);
        ctx.accounts.machine.active = false;
        Ok(())
    }
    pub fn create_offer(
        ctx: Context<CreateOffer>,
        id: [u8; 32],
        rate: u64,
        min_seconds: u32,
        max_seconds: u32,
        expires_at: i64,
    ) -> Result<()> {
        require!(
            rate > 0
                && min_seconds > 0
                && max_seconds >= min_seconds
                && max_seconds <= 86400
                && expires_at > Clock::get()?.unix_timestamp,
            MarketError::Bounds
        );
        let o = &mut ctx.accounts.offer;
        o.machine = ctx.accounts.machine.key();
        o.id = id;
        o.rate = rate;
        o.min_seconds = min_seconds;
        o.max_seconds = max_seconds;
        o.expires_at = expires_at;
        o.active = true;
        o.bump = ctx.bumps.offer;
        Ok(())
    }
    pub fn pause_offer(ctx: Context<ManageOffer>, paused: bool) -> Result<()> {
        ctx.accounts.offer.active = !paused;
        Ok(())
    }
    pub fn update_offer(
        ctx: Context<ManageOffer>,
        rate: u64,
        min_seconds: u32,
        max_seconds: u32,
        expires_at: i64,
    ) -> Result<()> {
        require!(
            rate > 0
                && min_seconds > 0
                && max_seconds >= min_seconds
                && max_seconds <= 86400
                && expires_at > Clock::get()?.unix_timestamp,
            MarketError::Bounds
        );
        let offer = &mut ctx.accounts.offer;
        offer.rate = rate;
        offer.min_seconds = min_seconds;
        offer.max_seconds = max_seconds;
        offer.expires_at = expires_at;
        Ok(())
    }
    pub fn close_offer(ctx: Context<CloseOffer>) -> Result<()> {
        require!(!ctx.accounts.machine.busy, MarketError::Capacity);
        Ok(())
    }
    pub fn assign_offer(ctx: Context<AssignOffer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let job = &ctx.accounts.job;
        let offer = &ctx.accounts.offer;
        require!(
            job.state == OPEN
                && now < job.deadline
                && offer.active
                && now < offer.expires_at
                && job.timeout >= offer.min_seconds
                && job.timeout <= offer.max_seconds,
            MarketError::State
        );
        active_worker(&ctx.accounts.worker_auth, now)?;
        require!(
            ctx.accounts.provider.active
                && ctx.accounts.machine.active
                && !ctx.accounts.machine.busy,
            MarketError::Capacity
        );
        require!(
            ctx.accounts.provider.authority != job.verifier,
            MarketError::Unauthorized
        );
        let price = offer
            .rate
            .checked_mul(job.timeout as u64)
            .ok_or(MarketError::Overflow)?;
        require!(price > 0 && price <= job.deposit, MarketError::Bounds);
        let job = &mut ctx.accounts.job;
        job.provider = ctx.accounts.provider.key();
        job.payout = ctx.accounts.provider.authority;
        job.machine = ctx.accounts.machine.key();
        job.worker = ctx.accounts.machine.worker;
        job.price = price;
        job.state = ASSIGNED;
        ctx.accounts.machine.busy = true;
        ctx.accounts.machine.active_job = job.key();
        emit_state(job.key(), ASSIGNED);
        Ok(())
    }
    pub fn create_job(
        ctx: Context<CreateJob>,
        id: [u8; 32],
        spec_hash: [u8; 32],
        budget: u64,
        deadline: i64,
        timeout: u32,
        policy: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        require!(
            budget > 0
                && budget <= 1_000_000_000_000
                && deadline > now
                && deadline <= now + 86400
                && timeout > 0
                && timeout <= 86400
                && policy <= 5
                && spec_hash != [0; 32],
            MarketError::Bounds
        );
        let j = &mut ctx.accounts.job;
        j.id = id;
        j.buyer = ctx.accounts.buyer.key();
        j.spec_hash = spec_hash;
        j.mint = ctx.accounts.config.mint;
        j.treasury = ctx.accounts.config.treasury;
        j.verifier = ctx.accounts.config.verifier;
        j.resolver = ctx.accounts.config.resolver;
        j.fee_bps = ctx.accounts.config.fee_bps;
        j.dispute_seconds = ctx.accounts.config.dispute_seconds;
        j.budget = budget;
        j.deadline = deadline;
        j.timeout = timeout;
        j.policy = policy;
        j.state = CREATED;
        j.bump = ctx.bumps.job;
        emit_state(j.key(), CREATED);
        Ok(())
    }
    pub fn create_agent_job(
        ctx: Context<CreateAgentJob>,
        id: [u8; 32],
        spec_hash: [u8; 32],
        budget: u64,
        deadline: i64,
        timeout: u32,
        verification_policy: u8,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        let policy = &mut ctx.accounts.agent_policy;
        require!(
            policy.active
                && now < policy.expires_at
                && budget > 0
                && budget <= policy.single_job_limit
                && deadline > now
                && deadline <= now + 86_400
                && timeout > 0
                && timeout <= policy.max_runtime_seconds
                && verification_policy >= policy.required_verification
                && verification_policy <= 5
                && spec_hash != [0; 32],
            MarketError::Bounds
        );
        verify_spec_membership(spec_hash, &proof, policy.allowed_specs_root)?;
        let day = now.div_euclid(86_400);
        if policy.day_index != day {
            policy.day_index = day;
            policy.daily_spent = 0;
        }
        let new_daily_spent = policy
            .daily_spent
            .checked_add(budget)
            .ok_or(MarketError::Overflow)?;
        require!(
            new_daily_spent <= policy.daily_spend_limit,
            MarketError::Bounds
        );
        require!(
            ctx.accounts.source.delegate == COption::Some(ctx.accounts.agent.key())
                && ctx.accounts.source.delegated_amount >= budget,
            MarketError::Unauthorized
        );
        policy.daily_spent = new_daily_spent;

        let job = &mut ctx.accounts.job;
        job.id = id;
        job.buyer = ctx.accounts.owner.key();
        job.spec_hash = spec_hash;
        job.mint = ctx.accounts.config.mint;
        job.treasury = ctx.accounts.config.treasury;
        job.verifier = ctx.accounts.config.verifier;
        job.resolver = ctx.accounts.config.resolver;
        job.fee_bps = ctx.accounts.config.fee_bps;
        job.dispute_seconds = ctx.accounts.config.dispute_seconds;
        job.budget = budget;
        job.deadline = deadline;
        job.timeout = timeout;
        job.policy = verification_policy;
        job.state = CREATED;
        job.bump = ctx.bumps.job;
        emit_state(job.key(), CREATED);

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            budget,
            ctx.accounts.mint.decimals,
        )?;
        let job = &mut ctx.accounts.job;
        job.deposit = budget;
        job.state = OPEN;
        emit_state(job.key(), OPEN);
        Ok(())
    }
    pub fn fund_job(ctx: Context<FundJob>) -> Result<()> {
        let j = &ctx.accounts.job;
        require!(
            j.state == CREATED && Clock::get()?.unix_timestamp < j.deadline,
            MarketError::State
        );
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            j.budget,
            ctx.accounts.mint.decimals,
        )?;
        let j = &mut ctx.accounts.job;
        j.deposit = j.budget;
        j.state = OPEN;
        emit_state(j.key(), OPEN);
        Ok(())
    }
    pub fn place_bid(
        ctx: Context<PlaceBid>,
        price: u64,
        estimated_start: i64,
        expires_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let j = &ctx.accounts.job;
        require!(
            j.state == OPEN
                && now < j.deadline
                && expires_at > now
                && expires_at <= j.deadline
                && estimated_start >= now
                && estimated_start <= j.deadline
                && price > 0
                && price <= j.deposit,
            MarketError::Bounds
        );
        active_worker(&ctx.accounts.worker_auth, now)?;
        require!(
            ctx.accounts.machine.active && ctx.accounts.provider.active,
            MarketError::Unauthorized
        );
        let b = &mut ctx.accounts.bid;
        b.job = j.key();
        b.provider = ctx.accounts.provider.key();
        b.machine = ctx.accounts.machine.key();
        b.worker = ctx.accounts.worker.key();
        b.price = price;
        b.estimated_start = estimated_start;
        b.expires_at = expires_at;
        b.active = true;
        b.bump = ctx.bumps.bid;
        Ok(())
    }
    pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
        active_worker(&ctx.accounts.worker_auth, Clock::get()?.unix_timestamp)?;
        require!(ctx.accounts.job.state == OPEN, MarketError::State);
        ctx.accounts.bid.active = false;
        Ok(())
    }
    pub fn accept_bid(ctx: Context<AcceptBid>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let b = &ctx.accounts.bid;
        let j = &mut ctx.accounts.job;
        require!(
            j.state == OPEN
                && now < j.deadline
                && b.active
                && now < b.expires_at
                && b.price <= j.deposit,
            MarketError::State
        );
        active_worker(&ctx.accounts.worker_auth, now)?;
        require!(
            ctx.accounts.machine.active
                && !ctx.accounts.machine.busy
                && ctx.accounts.provider.active,
            MarketError::Capacity
        );
        require!(
            ctx.accounts.provider.authority != j.verifier,
            MarketError::Unauthorized
        );
        j.provider = ctx.accounts.provider.key();
        j.payout = ctx.accounts.provider.authority;
        j.machine = b.machine;
        j.worker = b.worker;
        j.price = b.price;
        j.state = ASSIGNED;
        ctx.accounts.machine.busy = true;
        ctx.accounts.machine.active_job = j.key();
        emit_state(j.key(), ASSIGNED);
        Ok(())
    }
    pub fn accept_agent_bid(ctx: Context<AcceptAgentBid>, proof: Vec<[u8; 32]>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let policy = &ctx.accounts.agent_policy;
        let bid = &ctx.accounts.bid;
        let job = &mut ctx.accounts.job;
        require!(
            policy.active
                && now < policy.expires_at
                && job.timeout <= policy.max_runtime_seconds
                && job.policy >= policy.required_verification,
            MarketError::Unauthorized
        );
        verify_spec_membership(job.spec_hash, &proof, policy.allowed_specs_root)?;
        require!(
            job.state == OPEN
                && now < job.deadline
                && bid.active
                && now < bid.expires_at
                && bid.price <= job.deposit,
            MarketError::State
        );
        active_worker(&ctx.accounts.worker_auth, now)?;
        require!(
            ctx.accounts.machine.active
                && !ctx.accounts.machine.busy
                && ctx.accounts.provider.active,
            MarketError::Capacity
        );
        require!(
            ctx.accounts.provider.authority != job.verifier,
            MarketError::Unauthorized
        );
        job.provider = ctx.accounts.provider.key();
        job.payout = ctx.accounts.provider.authority;
        job.machine = bid.machine;
        job.worker = bid.worker;
        job.price = bid.price;
        job.state = ASSIGNED;
        ctx.accounts.machine.busy = true;
        ctx.accounts.machine.active_job = job.key();
        emit_state(job.key(), ASSIGNED);
        Ok(())
    }
    pub fn start_job(ctx: Context<WorkerJob>) -> Result<()> {
        active_worker(&ctx.accounts.worker_auth, Clock::get()?.unix_timestamp)?;
        let j = &mut ctx.accounts.job;
        require!(
            j.state == ASSIGNED && Clock::get()?.unix_timestamp <= j.deadline,
            MarketError::State
        );
        j.started_at = Clock::get()?.unix_timestamp;
        j.state = RUNNING;
        emit_state(j.key(), RUNNING);
        Ok(())
    }
    pub fn submit_receipt(ctx: Context<WorkerJob>, receipt_hash: [u8; 32]) -> Result<()> {
        active_worker(&ctx.accounts.worker_auth, Clock::get()?.unix_timestamp)?;
        let j = &mut ctx.accounts.job;
        require!(
            j.state == RUNNING
                && receipt_hash != [0; 32]
                && Clock::get()?.unix_timestamp <= j.started_at + j.timeout as i64 + 60,
            MarketError::State
        );
        j.receipt_hash = receipt_hash;
        j.submitted_at = Clock::get()?.unix_timestamp;
        j.state = VERIFYING;
        emit_state(j.key(), VERIFYING);
        Ok(())
    }
    pub fn submit_verification(
        ctx: Context<VerifyJob>,
        receipt_hash: [u8; 32],
        passed: bool,
    ) -> Result<()> {
        let j = &mut ctx.accounts.job;
        require!(
            j.state == VERIFYING && receipt_hash == j.receipt_hash,
            MarketError::State
        );
        require!(
            ctx.accounts.verifier.key() != j.worker && ctx.accounts.verifier.key() != j.payout,
            MarketError::Unauthorized
        );
        j.verified_at = Clock::get()?.unix_timestamp;
        j.state = if passed { COMPLETED } else { FAILED };
        emit_state(j.key(), j.state);
        Ok(())
    }
    pub fn cancel_job(ctx: Context<BuyerJob>) -> Result<()> {
        let j = &mut ctx.accounts.job;
        require!(j.state == CREATED || j.state == OPEN, MarketError::State);
        j.state = CANCELLED;
        emit_state(j.key(), CANCELLED);
        Ok(())
    }
    pub fn cancel_agent_job(ctx: Context<AgentJob>, proof: Vec<[u8; 32]>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let policy = &ctx.accounts.agent_policy;
        require!(
            policy.active && now < policy.expires_at,
            MarketError::Unauthorized
        );
        let job = &mut ctx.accounts.job;
        require!(
            job.timeout <= policy.max_runtime_seconds && job.policy >= policy.required_verification,
            MarketError::Unauthorized
        );
        verify_spec_membership(job.spec_hash, &proof, policy.allowed_specs_root)?;
        require!(
            job.state == CREATED || job.state == OPEN,
            MarketError::State
        );
        job.state = CANCELLED;
        emit_state(job.key(), CANCELLED);
        Ok(())
    }
    pub fn expire_job(ctx: Context<AnyJob>) -> Result<()> {
        let j = &mut ctx.accounts.job;
        let now = Clock::get()?.unix_timestamp;
        require!(
            ((j.state == OPEN || j.state == ASSIGNED || j.state == CREATED) && now > j.deadline)
                || (j.state == RUNNING && now > j.started_at + j.timeout as i64 + 60)
                || (j.state == VERIFYING && now > j.submitted_at + 86400),
            MarketError::State
        );
        j.state = EXPIRED;
        emit_state(j.key(), EXPIRED);
        Ok(())
    }
    pub fn open_dispute(ctx: Context<BuyerJob>, evidence_hash: [u8; 32]) -> Result<()> {
        let j = &mut ctx.accounts.job;
        require!(
            !j.settled
                && j.state == COMPLETED
                && Clock::get()?.unix_timestamp < j.verified_at + j.dispute_seconds
                && evidence_hash != [0; 32],
            MarketError::State
        );
        j.evidence_hash = evidence_hash;
        j.state = DISPUTED;
        emit_state(j.key(), DISPUTED);
        Ok(())
    }
    pub fn resolve_dispute(ctx: Context<ResolveJob>, provider_award: u64) -> Result<()> {
        let j = &mut ctx.accounts.job;
        require!(
            j.state == DISPUTED && provider_award <= j.price,
            MarketError::State
        );
        j.price = provider_award;
        j.state = COMPLETED;
        j.verified_at = Clock::get()?.unix_timestamp - j.dispute_seconds;
        j.resolved = true;
        emit_state(j.key(), COMPLETED);
        Ok(())
    }
    pub fn settle_job(ctx: Context<SettleJob>) -> Result<()> {
        let j = &ctx.accounts.job;
        require!(
            !j.settled
                && j.state == COMPLETED
                && Clock::get()?.unix_timestamp >= j.verified_at + j.dispute_seconds,
            MarketError::State
        );
        let (payment, fee, refund) = split(j.deposit, j.price, j.fee_bps)?;
        let buyer = j.buyer;
        let id = j.id;
        let bump = [j.bump];
        let seeds: &[&[u8]] = &[b"job", buyer.as_ref(), id.as_ref(), &bump];
        for (destination, amount) in [
            (&ctx.accounts.payout, payment),
            (&ctx.accounts.treasury, fee),
            (&ctx.accounts.refund, refund),
        ] {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.escrow.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: destination.to_account_info(),
                        authority: ctx.accounts.job.to_account_info(),
                    },
                    &[seeds],
                ),
                amount,
                ctx.accounts.mint.decimals,
            )?;
        }
        let j = &mut ctx.accounts.job;
        j.settled = true;
        j.provider_paid = payment;
        j.fee_paid = fee;
        j.refunded = refund;
        ctx.accounts.machine.busy = false;
        ctx.accounts.machine.completed = ctx
            .accounts
            .machine
            .completed
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;
        ctx.accounts.provider.completed = ctx
            .accounts
            .provider
            .completed
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;
        emit_state(j.key(), COMPLETED);
        Ok(())
    }
    pub fn refund_job(ctx: Context<RefundJob>) -> Result<()> {
        let j = &ctx.accounts.job;
        require!(
            !j.settled && [CANCELLED, EXPIRED, FAILED].contains(&j.state),
            MarketError::State
        );
        let buyer = j.buyer;
        let id = j.id;
        let bump = [j.bump];
        let seeds: &[&[u8]] = &[b"job", buyer.as_ref(), id.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.refund.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                &[seeds],
            ),
            j.deposit,
            ctx.accounts.mint.decimals,
        )?;
        let j = &mut ctx.accounts.job;
        j.settled = true;
        j.refunded = j.deposit;
        j.state = REFUNDED;
        emit_state(j.key(), REFUNDED);
        Ok(())
    }
    pub fn release_machine(ctx: Context<ReleaseMachine>) -> Result<()> {
        require!(
            ctx.accounts.job.settled && ctx.accounts.job.state == REFUNDED,
            MarketError::State
        );
        require!(
            ctx.accounts.machine.busy && ctx.accounts.machine.active_job == ctx.accounts.job.key(),
            MarketError::State
        );
        ctx.accounts.machine.busy = false;
        ctx.accounts.machine.failed = ctx
            .accounts
            .machine
            .failed
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;
        Ok(())
    }
}
fn active_worker(w: &WorkerAuthorization, now: i64) -> Result<()> {
    require!(w.active && w.expires_at > now, MarketError::Unauthorized);
    Ok(())
}
fn verify_spec_membership(spec_hash: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> Result<()> {
    require!(proof.len() <= 16, MarketError::Bounds);
    let mut node = spec_hash;
    for sibling in proof {
        node = if node <= *sibling {
            hashv(&[&node, sibling]).to_bytes()
        } else {
            hashv(&[sibling, &node]).to_bytes()
        };
    }
    require!(node == root, MarketError::Unauthorized);
    Ok(())
}
fn validate_agent_policy(
    daily_spend_limit: u64,
    single_job_limit: u64,
    max_runtime_seconds: u32,
    required_verification: u8,
    allowed_specs_root: [u8; 32],
    expires_at: i64,
) -> Result<()> {
    require!(
        daily_spend_limit > 0
            && single_job_limit > 0
            && single_job_limit <= daily_spend_limit
            && (1..=86_400).contains(&max_runtime_seconds)
            && required_verification <= 5
            && allowed_specs_root != [0; 32]
            && expires_at > Clock::get()?.unix_timestamp,
        MarketError::Bounds
    );
    Ok(())
}
pub fn split(deposit: u64, price: u64, fee_bps: u16) -> Result<(u64, u64, u64)> {
    require!(fee_bps <= 300 && price <= deposit, MarketError::Bounds);
    let fee = ((price as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(MarketError::Overflow)?
        / 10000) as u64;
    Ok((
        price.checked_sub(fee).ok_or(MarketError::Overflow)?,
        fee,
        deposit.checked_sub(price).ok_or(MarketError::Overflow)?,
    ))
}
fn emit_state(job: Pubkey, state: u8) {
    emit!(JobChanged { job, state });
}
fn emit_stake(provider: Pubkey, action: u8, amount: u64, balance: u64) {
    emit!(StakeChanged {
        provider,
        action,
        amount,
        balance,
    });
}
#[event]
pub struct JobChanged {
    pub job: Pubkey,
    pub state: u8,
}
#[event]
pub struct StakeChanged {
    pub provider: Pubkey,
    pub action: u8,
    pub amount: u64,
    pub balance: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init,payer=admin,space=8+ProtocolConfig::INIT_SPACE,seeds=[b"config"],bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    pub mint: Account<'info, Mint>,
    /// CHECK: treasury owner address; token destination is constrained at settlement.
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: designated verification signer, pinned in config and snapshotted per job.
    pub verifier: UncheckedAccount<'info>,
    #[account(constraint=program.programdata_address()?==Some(program_data.key()))]
    pub program: Program<'info, crate::program::ComputeMarket>,
    #[account(constraint=program_data.upgrade_authority_address==Some(admin.key()) @ MarketError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Admin<'info> {
    pub admin: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, ProtocolConfig>,
}
#[derive(Accounts)]
pub struct CreateAgentPolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: bounded delegated authority; it never owns the owner's funds.
    pub agent: UncheckedAccount<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(address=config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(init,payer=owner,space=8+AgentPolicy::INIT_SPACE,seeds=[b"agent-policy",owner.key().as_ref(),agent.key().as_ref()],bump)]
    pub agent_policy: Box<Account<'info, AgentPolicy>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ManageAgentPolicy<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,seeds=[b"agent-policy",owner.key().as_ref(),agent_policy.agent.as_ref()],bump=agent_policy.bump)]
    pub agent_policy: Account<'info, AgentPolicy>,
}
#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(init,payer=authority,space=8+Provider::INIT_SPACE,seeds=[b"provider",authority.key().as_ref()],bump)]
    pub provider: Account<'info, Provider>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ManageProvider<'info> {
    pub authority: Signer<'info>,
    #[account(mut,has_one=authority)]
    pub provider: Account<'info, Provider>,
}
#[derive(Accounts)]
pub struct InitializeProviderStake<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(address=config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(init,payer=authority,space=8+ProviderStake::INIT_SPACE,seeds=[b"stake",provider.key().as_ref()],bump)]
    pub stake: Account<'info, ProviderStake>,
    #[account(init,payer=authority,seeds=[b"stake-vault",provider.key().as_ref()],bump,token::mint=mint,token::authority=stake)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct DepositStake<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,seeds=[b"stake",provider.key().as_ref()],bump=stake.bump)]
    pub stake: Account<'info, ProviderStake>,
    #[account(address=stake.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut,token::mint=mint,token::authority=authority)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut,seeds=[b"stake-vault",provider.key().as_ref()],bump,token::mint=mint,token::authority=stake)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct ManageStake<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,seeds=[b"stake",provider.key().as_ref()],bump=stake.bump)]
    pub stake: Account<'info, ProviderStake>,
}
#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,seeds=[b"stake",provider.key().as_ref()],bump=stake.bump)]
    pub stake: Account<'info, ProviderStake>,
    #[account(address=stake.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut,seeds=[b"stake-vault",provider.key().as_ref()],bump,token::mint=mint,token::authority=stake)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,token::authority=authority)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct SlashStake<'info> {
    pub resolver: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,has_one=resolver)]
    pub config: Account<'info, ProtocolConfig>,
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,seeds=[b"stake",provider.key().as_ref()],bump=stake.bump)]
    pub stake: Account<'info, ProviderStake>,
    #[account(address=config.mint,constraint=mint.key()==stake.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut,seeds=[b"stake-vault",provider.key().as_ref()],bump,token::mint=mint,token::authority=stake)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,constraint=treasury.owner==config.treasury)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct AuthorizeWorker<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one=authority,seeds=[b"provider",authority.key().as_ref()],bump=provider.bump)]
    pub provider: Account<'info, Provider>,
    /// CHECK: public key being delegated, no custody privileges.
    pub worker: UncheckedAccount<'info>,
    #[account(init,payer=authority,space=8+WorkerAuthorization::INIT_SPACE,seeds=[b"worker",provider.key().as_ref(),worker.key().as_ref()],bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct RevokeWorker<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,seeds=[b"worker",provider.key().as_ref(),worker_auth.worker.as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
}
#[derive(Accounts)]
pub struct RotateWorker<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,seeds=[b"worker",provider.key().as_ref(),old_worker_auth.worker.as_ref()],bump=old_worker_auth.bump)]
    pub old_worker_auth: Account<'info, WorkerAuthorization>,
    /// CHECK: public key receiving bounded worker authority.
    pub new_worker: UncheckedAccount<'info>,
    #[account(init,payer=authority,space=8+WorkerAuthorization::INIT_SPACE,seeds=[b"worker",provider.key().as_ref(),new_worker.key().as_ref()],bump)]
    pub new_worker_auth: Account<'info, WorkerAuthorization>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(id:[u8;32])]
pub struct RegisterMachine<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider,constraint=worker_auth.active @ MarketError::Unauthorized)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
    #[account(init,payer=authority,space=8+Machine::INIT_SPACE,seeds=[b"machine",provider.key().as_ref(),id.as_ref()],bump)]
    pub machine: Account<'info, Machine>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ManageMachine<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider)]
    pub machine: Account<'info, Machine>,
    #[account(has_one=provider,constraint=worker_auth.active @ MarketError::Unauthorized)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
}
#[derive(Accounts)]
pub struct DeactivateMachine<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider)]
    pub machine: Account<'info, Machine>,
}
#[derive(Accounts)]
#[instruction(id:[u8;32])]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider)]
    pub machine: Account<'info, Machine>,
    #[account(init,payer=authority,space=8+Offer::INIT_SPACE,seeds=[b"offer",machine.key().as_ref(),id.as_ref()],bump)]
    pub offer: Account<'info, Offer>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ManageOffer<'info> {
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider)]
    pub machine: Account<'info, Machine>,
    #[account(mut,has_one=machine)]
    pub offer: Account<'info, Offer>,
}
#[derive(Accounts)]
pub struct CloseOffer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider)]
    pub machine: Account<'info, Machine>,
    #[account(mut,close=authority,has_one=machine)]
    pub offer: Account<'info, Offer>,
}
#[derive(Accounts)]
pub struct AssignOffer<'info> {
    pub buyer: Signer<'info>,
    #[account(mut,has_one=buyer)]
    pub job: Box<Account<'info, Job>>,
    #[account(has_one=machine)]
    pub offer: Account<'info, Offer>,
    #[account(mut,has_one=provider,constraint=machine.key()==offer.machine)]
    pub machine: Account<'info, Machine>,
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider,constraint=worker_auth.worker==machine.worker,seeds=[b"worker",provider.key().as_ref(),machine.worker.as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
}
#[derive(Accounts)]
#[instruction(id:[u8;32])]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(init,payer=buyer,space=8+Job::INIT_SPACE,seeds=[b"job",buyer.key().as_ref(),id.as_ref()],bump)]
    pub job: Account<'info, Job>,
    #[account(address=config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(init,payer=buyer,seeds=[b"escrow",job.key().as_ref()],bump,token::mint=mint,token::authority=job)]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(id:[u8;32])]
pub struct CreateAgentJob<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    /// CHECK: policy owner, job buyer, source owner and refund recipient.
    pub owner: UncheckedAccount<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut,has_one=owner,has_one=agent,has_one=mint,seeds=[b"agent-policy",owner.key().as_ref(),agent.key().as_ref()],bump=agent_policy.bump)]
    pub agent_policy: Box<Account<'info, AgentPolicy>>,
    #[account(init,payer=agent,space=8+Job::INIT_SPACE,seeds=[b"job",owner.key().as_ref(),id.as_ref()],bump)]
    pub job: Box<Account<'info, Job>>,
    #[account(address=config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut,token::mint=mint,constraint=source.owner==owner.key())]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=agent,seeds=[b"escrow",job.key().as_ref()],bump,token::mint=mint,token::authority=job)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct FundJob<'info> {
    pub buyer: Signer<'info>,
    #[account(mut,has_one=buyer,has_one=mint,seeds=[b"job",buyer.key().as_ref(),job.id.as_ref()],bump=job.bump)]
    pub job: Account<'info, Job>,
    pub mint: Account<'info, Mint>,
    #[account(mut,token::mint=mint,token::authority=buyer)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut,seeds=[b"escrow",job.key().as_ref()],bump,token::mint=mint,token::authority=job)]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    pub job: Account<'info, Job>,
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider,has_one=worker,seeds=[b"worker",provider.key().as_ref(),worker.key().as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
    #[account(has_one=provider,has_one=worker)]
    pub machine: Account<'info, Machine>,
    #[account(init,payer=worker,space=8+Bid::INIT_SPACE,seeds=[b"bid",job.key().as_ref(),provider.key().as_ref()],bump)]
    pub bid: Account<'info, Bid>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CancelBid<'info> {
    pub worker: Signer<'info>,
    pub job: Account<'info, Job>,
    pub provider: Account<'info, Provider>,
    #[account(has_one=provider,has_one=worker,seeds=[b"worker",provider.key().as_ref(),worker.key().as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
    #[account(mut,has_one=job,has_one=provider,has_one=worker)]
    pub bid: Account<'info, Bid>,
}
#[derive(Accounts)]
pub struct AcceptBid<'info> {
    pub buyer: Signer<'info>,
    #[account(mut,has_one=buyer)]
    pub job: Account<'info, Job>,
    #[account(has_one=job,has_one=provider,has_one=machine)]
    pub bid: Account<'info, Bid>,
    pub provider: Account<'info, Provider>,
    #[account(mut,has_one=provider,constraint=machine.worker==bid.worker)]
    pub machine: Account<'info, Machine>,
    #[account(has_one=provider,constraint=worker_auth.worker==bid.worker,seeds=[b"worker",provider.key().as_ref(),bid.worker.as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
}
#[derive(Accounts)]
pub struct AcceptAgentBid<'info> {
    pub agent: Signer<'info>,
    /// CHECK: policy owner and job buyer.
    pub owner: UncheckedAccount<'info>,
    #[account(has_one=owner,has_one=agent,seeds=[b"agent-policy",owner.key().as_ref(),agent.key().as_ref()],bump=agent_policy.bump)]
    pub agent_policy: Box<Account<'info, AgentPolicy>>,
    #[account(mut,constraint=job.buyer==owner.key())]
    pub job: Box<Account<'info, Job>>,
    #[account(has_one=job,has_one=provider,has_one=machine)]
    pub bid: Box<Account<'info, Bid>>,
    pub provider: Box<Account<'info, Provider>>,
    #[account(mut,has_one=provider,constraint=machine.worker==bid.worker)]
    pub machine: Box<Account<'info, Machine>>,
    #[account(has_one=provider,constraint=worker_auth.worker==bid.worker,seeds=[b"worker",provider.key().as_ref(),bid.worker.as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Box<Account<'info, WorkerAuthorization>>,
}
#[derive(Accounts)]
pub struct WorkerJob<'info> {
    pub worker: Signer<'info>,
    #[account(mut,has_one=worker)]
    pub job: Account<'info, Job>,
    #[account(has_one=worker,constraint=worker_auth.provider==job.provider,seeds=[b"worker",job.provider.as_ref(),worker.key().as_ref()],bump=worker_auth.bump)]
    pub worker_auth: Account<'info, WorkerAuthorization>,
}
#[derive(Accounts)]
pub struct VerifyJob<'info> {
    pub verifier: Signer<'info>,
    #[account(mut,has_one=verifier)]
    pub job: Account<'info, Job>,
}
#[derive(Accounts)]
pub struct BuyerJob<'info> {
    pub buyer: Signer<'info>,
    #[account(mut,has_one=buyer)]
    pub job: Account<'info, Job>,
}
#[derive(Accounts)]
pub struct AgentJob<'info> {
    pub agent: Signer<'info>,
    /// CHECK: policy owner and job buyer.
    pub owner: UncheckedAccount<'info>,
    #[account(has_one=owner,has_one=agent,seeds=[b"agent-policy",owner.key().as_ref(),agent.key().as_ref()],bump=agent_policy.bump)]
    pub agent_policy: Account<'info, AgentPolicy>,
    #[account(mut,constraint=job.buyer==owner.key())]
    pub job: Account<'info, Job>,
}
#[derive(Accounts)]
pub struct AnyJob<'info> {
    #[account(mut)]
    pub job: Account<'info, Job>,
}
#[derive(Accounts)]
pub struct ResolveJob<'info> {
    pub resolver: Signer<'info>,
    #[account(mut,has_one=resolver)]
    pub job: Account<'info, Job>,
}
#[derive(Accounts)]
pub struct SettleJob<'info> {
    #[account(mut,has_one=mint,has_one=provider,has_one=machine,seeds=[b"job",job.buyer.as_ref(),job.id.as_ref()],bump=job.bump)]
    pub job: Box<Account<'info, Job>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut,seeds=[b"escrow",job.key().as_ref()],bump,token::mint=mint,token::authority=job)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=mint,constraint=payout.owner==job.payout)]
    pub payout: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=mint,constraint=treasury.owner==job.treasury)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=mint,constraint=refund.owner==job.buyer)]
    pub refund: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub provider: Box<Account<'info, Provider>>,
    #[account(mut,has_one=provider)]
    pub machine: Box<Account<'info, Machine>>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct RefundJob<'info> {
    #[account(mut,has_one=mint,seeds=[b"job",job.buyer.as_ref(),job.id.as_ref()],bump=job.bump)]
    pub job: Account<'info, Job>,
    pub mint: Account<'info, Mint>,
    #[account(mut,seeds=[b"escrow",job.key().as_ref()],bump,token::mint=mint,token::authority=job)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,constraint=refund.owner==job.buyer)]
    pub refund: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct ReleaseMachine<'info> {
    pub job: Account<'info, Job>,
    #[account(mut,constraint=machine.key()==job.machine)]
    pub machine: Account<'info, Machine>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub verifier: Pubkey,
    pub resolver: Pubkey,
    pub fee_bps: u16,
    pub dispute_seconds: i64,
    pub paused: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Provider {
    pub authority: Pubkey,
    pub metadata_hash: [u8; 32],
    pub active: bool,
    pub completed: u64,
    pub failed: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ProviderStake {
    pub provider: Pubkey,
    pub mint: Pubkey,
    pub deposited: u64,
    pub pending_withdrawal: u64,
    pub unlock_at: i64,
    pub total_slashed: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct AgentPolicy {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub daily_spend_limit: u64,
    pub single_job_limit: u64,
    pub max_runtime_seconds: u32,
    pub required_verification: u8,
    pub allowed_specs_root: [u8; 32],
    pub expires_at: i64,
    pub day_index: i64,
    pub daily_spent: u64,
    pub active: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct WorkerAuthorization {
    pub provider: Pubkey,
    pub worker: Pubkey,
    pub active: bool,
    pub expires_at: i64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Machine {
    pub provider: Pubkey,
    pub worker: Pubkey,
    pub id: [u8; 32],
    pub hardware_hash: [u8; 32],
    pub gpu_count: u16,
    pub vram_mb: u32,
    pub active: bool,
    pub busy: bool,
    pub active_job: Pubkey,
    pub completed: u64,
    pub failed: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Offer {
    pub machine: Pubkey,
    pub id: [u8; 32],
    pub rate: u64,
    pub min_seconds: u32,
    pub max_seconds: u32,
    pub expires_at: i64,
    pub active: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub job: Pubkey,
    pub provider: Pubkey,
    pub machine: Pubkey,
    pub worker: Pubkey,
    pub price: u64,
    pub estimated_start: i64,
    pub expires_at: i64,
    pub active: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Job {
    pub id: [u8; 32],
    pub buyer: Pubkey,
    pub spec_hash: [u8; 32],
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub verifier: Pubkey,
    pub resolver: Pubkey,
    pub provider: Pubkey,
    pub payout: Pubkey,
    pub machine: Pubkey,
    pub worker: Pubkey,
    pub receipt_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub budget: u64,
    pub deposit: u64,
    pub price: u64,
    pub provider_paid: u64,
    pub fee_paid: u64,
    pub refunded: u64,
    pub deadline: i64,
    pub started_at: i64,
    pub submitted_at: i64,
    pub verified_at: i64,
    pub dispute_seconds: i64,
    pub timeout: u32,
    pub fee_bps: u16,
    pub policy: u8,
    pub state: u8,
    pub settled: bool,
    pub resolved: bool,
    pub bump: u8,
}
#[error_code]
pub enum MarketError {
    #[msg("Unauthorized or revoked authority")]
    Unauthorized,
    #[msg("Invalid lifecycle transition")]
    State,
    #[msg("Protocol paused")]
    Paused,
    #[msg("Value outside allowed bounds")]
    Bounds,
    #[msg("Expired")]
    Expired,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Machine unavailable")]
    Capacity,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conservation() {
        for d in [1, 100, 100_000, u64::MAX] {
            for b in [0, 1, 200, 300] {
                let (p, f, r) = split(d, d, b).unwrap();
                assert_eq!(p as u128 + f as u128 + r as u128, d as u128);
            }
        }
    }
    #[test]
    fn reject_overbudget() {
        assert!(split(10, 11, 200).is_err());
        assert!(split(10, 10, 301).is_err());
    }

    #[test]
    fn verifies_single_leaf_spec_allowlist() {
        let leaf = [7_u8; 32];
        assert!(verify_spec_membership(leaf, &[], leaf).is_ok());
        assert!(verify_spec_membership([8_u8; 32], &[], leaf).is_err());
    }

    #[test]
    fn verifies_sorted_merkle_spec_allowlist() {
        let left = [2_u8; 32];
        let right = [9_u8; 32];
        let root = hashv(&[&left, &right]).to_bytes();
        assert!(verify_spec_membership(left, &[right], root).is_ok());
        assert!(verify_spec_membership(right, &[left], root).is_ok());
        assert!(verify_spec_membership(right, &[[3_u8; 32]], root).is_err());
    }
}
