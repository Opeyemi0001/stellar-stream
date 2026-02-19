#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Events, Address, Env};

#[test]
fn test_create_stream_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let total_amount: i128 = 1000;
    let start_time: u64 = 1000;
    let end_time: u64 = 2000;

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &total_amount,
        &start_time,
        &end_time,
    );

    // Verify StreamCreated event was emitted
    assert_eq!(
        env.events().all(),
        std::vec![StreamCreated {
            stream_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            total_amount,
            start_time,
            end_time,
        }
        .to_xdr(&env, &contract_id)]
    );
}

#[test]
fn test_claim_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let total_amount: i128 = 1000;
    let start_time: u64 = 1000;
    let end_time: u64 = 2000;

    // Create a stream first
    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &total_amount,
        &start_time,
        &end_time,
    );

    // Clear events from create_stream
    env.events().clear();

    // Set ledger timestamp to allow claiming
    env.ledger().set_timestamp(start_time + 500);

    let claim_amount: i128 = 500;
    let claimed = client.claim(&stream_id, &recipient, &claim_amount);

    assert_eq!(claimed, claim_amount);

    // Verify StreamClaimed event was emitted
    assert_eq!(
        env.events().all(),
        std::vec![StreamClaimed {
            stream_id,
            recipient: recipient.clone(),
            amount: claim_amount,
        }
        .to_xdr(&env, &contract_id)]
    );
}

#[test]
fn test_cancel_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let total_amount: i128 = 1000;
    let start_time: u64 = 1000;
    let end_time: u64 = 2000;

    // Create a stream first
    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &total_amount,
        &start_time,
        &end_time,
    );

    // Clear events from create_stream
    env.events().clear();

    // Cancel the stream
    client.cancel(&stream_id, &sender);

    // Verify StreamCanceled event was emitted
    assert_eq!(
        env.events().all(),
        std::vec![StreamCanceled {
            stream_id,
            sender: sender.clone(),
        }
        .to_xdr(&env, &contract_id)]
    );
}

#[test]
fn test_cancel_does_not_emit_event_when_already_canceled() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let total_amount: i128 = 1000;
    let start_time: u64 = 1000;
    let end_time: u64 = 2000;

    // Create a stream first
    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &total_amount,
        &start_time,
        &end_time,
    );

    // Clear events from create_stream
    env.events().clear();

    // Cancel the stream first time
    client.cancel(&stream_id, &sender);

    // Clear events from first cancel
    env.events().clear();

    // Cancel again - should not emit event
    client.cancel(&stream_id, &sender);

    // Verify no new event was emitted
    assert_eq!(env.events().all(), std::vec![]);
}
