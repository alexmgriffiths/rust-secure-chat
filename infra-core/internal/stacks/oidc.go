package stacks

import (
	"iac-core/internal/config"
	iconst "iac-core/internal/constructs"
	"iac-core/internal/outputs"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type OidcStackProps struct {
	awscdk.StackProps
	Core config.CoreConfig

	GitHubOrg    string
	GitHubRepos  []string // Multiple repos can use this role
	GitHubBranch string

	// Optional: keep if you want explicit thumbprints.
	// If nil, CDK/IAM will use its defaults. If your deploy complains, set these.
	Thumbprints *[]*string
}

type OidcStack struct {
	awscdk.Stack
	Role     awsiam.Role
	Provider awsiam.OpenIdConnectProvider
}

func NewOidcStack(scope constructs.Construct, id string, props *OidcStackProps) *OidcStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)

	p := &awsiam.OpenIdConnectProviderProps{
		Url: jsii.String("https://token.actions.githubusercontent.com"),
		ClientIds: &[]*string{
			jsii.String("sts.amazonaws.com"),
		},
	}
	if props.Thumbprints != nil {
		p.Thumbprints = props.Thumbprints
	}

	provider := awsiam.NewOpenIdConnectProvider(stack, jsii.String("GitHubOidcProvider"), p)

	// Trust policy restriction - build list of allowed repos
	var subPatterns []string
	for _, repo := range props.GitHubRepos {
		if props.GitHubBranch != "" {
			subPatterns = append(subPatterns, "repo:"+props.GitHubOrg+"/"+repo+":ref:refs/heads/"+props.GitHubBranch)
		} else {
			subPatterns = append(subPatterns, "repo:"+props.GitHubOrg+"/"+repo+":*")
		}
	}

	// Use ForAnyValue:StringLike for multiple repos
	conditions := &map[string]interface{}{
		"StringEquals": map[string]interface{}{
			"token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
		},
	}

	if len(subPatterns) == 1 {
		(*conditions)["StringLike"] = map[string]interface{}{
			"token.actions.githubusercontent.com:sub": subPatterns[0],
		}
	} else {
		(*conditions)["ForAnyValue:StringLike"] = map[string]interface{}{
			"token.actions.githubusercontent.com:sub": subPatterns,
		}
	}

	principal := awsiam.NewOpenIdConnectPrincipal(provider, nil).WithConditions(conditions)

	role := awsiam.NewRole(stack, jsii.String("GitHubActionsRole"), &awsiam.RoleProps{
		AssumedBy:          principal,
		RoleName:           jsii.String("GitHubActions-" + props.Core.Stage),
		Description:        jsii.String("GitHub Actions OIDC role for core CDK deployments"),
		MaxSessionDuration: awscdk.Duration_Hours(jsii.Number(1)),
	})

	// Overprovisioned access for core infra changes
	role.AddManagedPolicy(
		awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("AdministratorAccess")),
	)

	// Publish Role ARN to SSM
	ssm := outputs.NewCoreSSM(props.Core)
	iconst.PutStringParam(stack, "SsmGitHubActionsRoleArn", iconst.StringParamProps{
		Name:  ssm.GitHubActionsRoleArn(),
		Value: *role.RoleArn(),
	})

	awscdk.NewCfnOutput(stack, jsii.String("GitHubActionsRoleArn"), &awscdk.CfnOutputProps{
		Value: role.RoleArn(),
	})
	awscdk.NewCfnOutput(stack, jsii.String("OidcProviderArn"), &awscdk.CfnOutputProps{
		Value: provider.OpenIdConnectProviderArn(),
	})

	return &OidcStack{
		Stack:    stack,
		Role:     role,
		Provider: provider,
	}
}
