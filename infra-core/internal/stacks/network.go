package stacks

import (
	"iac-core/internal/config"
	iconst "iac-core/internal/constructs"
	"iac-core/internal/outputs"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type NetworkStackProps struct {
	awscdk.StackProps
	Core config.CoreConfig
}

type NetworkStack struct {
	awscdk.Stack
	Vpc awsec2.IVpc
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func NewNetworkStack(scope constructs.Construct, id string, props *NetworkStackProps) *NetworkStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)

	vpc := awsec2.NewVpc(stack, jsii.String("Vpc"), &awsec2.VpcProps{
		MaxAzs:      jsii.Number(3),
		NatGateways: jsii.Number(1),
		IpAddresses: awsec2.IpAddresses_Cidr(jsii.String("10.30.0.0/16")),
		SubnetConfiguration: &[]*awsec2.SubnetConfiguration{
			{
				Name:       jsii.String("public"),
				SubnetType: awsec2.SubnetType_PUBLIC,
			},
			{
				Name:       jsii.String("private"),
				SubnetType: awsec2.SubnetType_PRIVATE_WITH_EGRESS,
			},
			{
				Name:       jsii.String("isolated"),
				SubnetType: awsec2.SubnetType_PRIVATE_ISOLATED,
			},
		},
	})

	// High value endpoints for ECS in private subnets.
	vpc.AddGatewayEndpoint(jsii.String("S3Endpoint"), &awsec2.GatewayVpcEndpointOptions{
		Service: awsec2.GatewayVpcEndpointAwsService_S3(),
	})

	vpc.AddInterfaceEndpoint(jsii.String("EcrApiEndpoint"), &awsec2.InterfaceVpcEndpointOptions{
		Service: awsec2.InterfaceVpcEndpointAwsService_ECR(),
	})
	vpc.AddInterfaceEndpoint(jsii.String("EcrDkrEndpoint"), &awsec2.InterfaceVpcEndpointOptions{
		Service: awsec2.InterfaceVpcEndpointAwsService_ECR_DOCKER(),
	})
	vpc.AddInterfaceEndpoint(jsii.String("LogsEndpoint"), &awsec2.InterfaceVpcEndpointOptions{
		Service: awsec2.InterfaceVpcEndpointAwsService_CLOUDWATCH_LOGS(),
	})
	vpc.AddInterfaceEndpoint(jsii.String("SecretsEndpoint"), &awsec2.InterfaceVpcEndpointOptions{
		Service: awsec2.InterfaceVpcEndpointAwsService_SECRETS_MANAGER(),
	})
	vpc.AddInterfaceEndpoint(jsii.String("SsmEndpoint"), &awsec2.InterfaceVpcEndpointOptions{
		Service: awsec2.InterfaceVpcEndpointAwsService_SSM(),
	})
	vpc.AddInterfaceEndpoint(jsii.String("KmsEndpoint"), &awsec2.InterfaceVpcEndpointOptions{
		Service: awsec2.InterfaceVpcEndpointAwsService_KMS(),
	})

	ssm := outputs.NewCoreSSM(props.Core)

	privateSubnetIds := []string{}
	publicSubnetIds := []string{}
	isolatedSubnetIds := []string{}
	azs := []string{}

	for _, s := range *vpc.PrivateSubnets() {
		privateSubnetIds = append(privateSubnetIds, *s.SubnetId())
		if !contains(azs, *s.AvailabilityZone()) {
			azs = append(azs, *s.AvailabilityZone())
		}
	}
	for _, s := range *vpc.PublicSubnets() {
		publicSubnetIds = append(publicSubnetIds, *s.SubnetId())
		if !contains(azs, *s.AvailabilityZone()) {
			azs = append(azs, *s.AvailabilityZone())
		}
	}
	for _, s := range *vpc.IsolatedSubnets() {
		isolatedSubnetIds = append(isolatedSubnetIds, *s.SubnetId())
		if !contains(azs, *s.AvailabilityZone()) {
			azs = append(azs, *s.AvailabilityZone())
		}
	}

	iconst.PutStringParam(stack, "SsmVpcId", iconst.StringParamProps{
		Name:  ssm.VpcId(),
		Value: *vpc.VpcId(),
	})
	iconst.PutStringListParam(stack, "SsmPrivateSubnets", ssm.PrivateSubnetIds(), privateSubnetIds)
	iconst.PutStringListParam(stack, "SsmPublicSubnets", ssm.PublicSubnetIds(), publicSubnetIds)
	iconst.PutStringListParam(stack, "SsmIsolatedSubnets", ssm.IsolatedSubnetIds(), isolatedSubnetIds)
	iconst.PutStringListParam(stack, "SsmAvailabilityZones", ssm.AvailabilityZones(), azs)

	return &NetworkStack{
		Stack: stack,
		Vpc:   vpc,
	}
}
