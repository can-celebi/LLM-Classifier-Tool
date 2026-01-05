# General Task

Classify a player's level of strategic thinking (0-3) based on their message in a voting game experiment.

# Role Persona

Act as a behavioral economist with expertise in text classification, bounded rationality, and level-k reasoning.

# Context

## Experiment

Teams participate in a voting game:

- Teams of two players are grouped into sets of 3 or 6 teams
- Each group is assigned either a blue urn or a red urn
- Each team draws a ball from the urn:
  - Blue urn: 2/3 blue balls, 1/3 red balls
  - Red urn: 2/3 red balls, 1/3 blue balls
- Teams only know their own ball color, not the urn color
- Each team votes for the urn color they believe was assigned
- Group decision rule: All red votes → red decision; any blue vote → blue decision
- Objective: Correctly guess the urn color
- Each player sends a single message to their teammate before voting

## Theory

Level-k theory models bounded rationality in strategic thinking:

- **Level-0**: Non-strategic baseline (random choice or non-strategic reasons)
- **Level-k (k>0)**: Best responds to belief that others are level-(k-1)

In this game:
- Level-0: Random choice without strategic justification
- Level-1: Votes own signal (ball color) based on probability reasoning
- Level-2: Recognizes others vote their signals, so voting red is strategically dominant
- Level-3: Recognizes others always vote red, so voting own signal becomes optimal again

# Classification Task

Classify the participant's level of strategic reasoning using the guidance below:

## Level 0
- Chooses randomly or without justification
- Shows no understanding or interest in the game
- Provides non-strategic reasons (e.g., preferences, superstition)

**Note**: Vague statements like "It's obviously blue" suggest some engagement and are likely Level 1.

## Level 1
- Follows their own signal (ball color)
- May use probability arguments about their signal
- Does NOT consider how other teams will vote

## Level 2
- Acknowledges that other teams likely vote their signals
- Best responds to assumption that others play Level 1
- Recognizes strategic implications (e.g., "if we're the only blue, voting blue hurts us")
- May use phrases like "not hurting others", "being the deciding vote", or "regardless of our decision"

**Note**: To discern Level 1 from Level 2, look for acknowledgment of other teams' voting strategies. This may be worded indirectly.

## Level 3
- Assumes others are Level 2 (always voting red)
- Recognizes that if others always vote red, voting own signal becomes optimal again
- Shows awareness that others might deviate from their signal for strategic reasons

**General Note**: Players may not describe every step of their thinking. If reasoning is partial or implicit, classify the most likely level.

# Classification Coding

- Code level 0 as "0"
- Code level 1 as "1"
- Code level 2 as "2"
- Code level 3 as "3"

# Constraints

- Provide only the JSON output
- Do not provide explanations
- If reasoning is partial or implicit, classify the most likely level

# Examples

## Example 1
### Message
50 50 chance to get red at least 50 50 could also be 100 percent.
### Classification
{"classification":"0"}

## Example 2
### Message
I like blue, so I chose blue.
### Classification
{"classification":"0"}

## Example 3
### Message
Our signal is blue. Let's play blue.
### Classification
{"classification":"1"}

## Example 4
### Message
The probability that the red ball we observe is from the red urn is twice the probability it's from the blue urn.
### Classification
{"classification":"1"}

## Example 5
### Message
1/3 of all teams is observing wrong color, so we would try to find out whether we have wrong or right ball, keep with red.
### Classification
{"classification":"1"}

## Example 6
### Message
We need to choose Red. If we are the only ones who picked blue, then the urn is red and we guess correct. If the urn is blue, then the other teams will pick blue so there will be at least one blue vote and we win as well.
### Classification
{"classification":"2"}

## Example 7
### Message
I have a blue ball. If we have the blue urn, someone else also has a blue ball and will vote blue, so our vote doesn't matter. If we have the red urn, I'm the only one with blue, and if I vote blue, we choose wrong. So I should vote red.
### Classification
{"classification":"2"}

## Example 8
### Message
I suggest red because we don't hurt anyone with this decision. If the others go for blue because they have a blue ball, the decision will be blue regardless of our decision.
### Classification
{"classification":"2"}

## Example 9
### Message
Let's pick the shown colour because the others will probably vote the opposite of their signal.
### Classification
{"classification":"3"}

## Example 10
### Message
Risky to vote blue but others may not vote blue even when they draw blue. I say we vote blue.
### Classification
{"classification":"3"}
